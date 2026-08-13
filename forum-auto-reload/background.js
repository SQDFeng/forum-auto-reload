// ============================================
// 【重要】配置区域：改成你自己的论坛域名
// ============================================
// 示例：const TARGET_DOMAINS = ['bbs.example.com', 'www.example.com'];
// 如果你只访问一个论坛，只填一个就行
// 如果留空数组 []，则对所有网站生效（不推荐，可能误刷新其他页面）
const TARGET_DOMAINS = [
  // '这里改成你的论坛域名，比如 bbs.xxx.com'
];

// ============================================
// 重试管理（每个标签页独立计数）
// ============================================
const retryData = new Map();  // tabId -> { count, timestamp }

// 每小时清理一次过期记录（防止内存泄漏）
setInterval(() => {
  const now = Date.now();
  for (const [tabId, data] of retryData.entries()) {
    if (now - data.timestamp > 24 * 60 * 60 * 1000) {
      retryData.delete(tabId);
    }
  }
}, 60 * 60 * 1000);

// 检查 URL 是否属于目标论坛
function isTargetUrl(url) {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return false;
  }
  // 如果没配置域名，默认对所有网站生效
  if (TARGET_DOMAINS.length === 0) return true;
  
  try {
    const hostname = new URL(url).hostname;
    return TARGET_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

// 检查当前是否是错误页面
function isErrorPage(url, title) {
  if (!url && !title) return false;
  
  // Chrome 错误页面的 URL 特征
  const isErrorUrl = url && (
    url.startsWith('chrome-error://') || 
    url.startsWith('about:neterror')
  );
  
  // 错误页面标题常见关键词（中英文）
  const isErrorTitle = title && (
    title.includes('ERR_') ||
    title.includes('无法访问') ||
    title.includes('未连接到互联网') ||
    title.includes('No internet') ||
    title.includes('无法访问此网站') ||
    title.includes('This site can') ||
    title.includes('无法连接') ||
    title.includes(' refused') ||
    title.includes('timed out')
  );
  
  return isErrorUrl || isErrorTitle;
}

// 执行刷新，带"指数退避"策略（越失败等越久，避免疯狂刷屏）
function scheduleReload(tabId, reason) {
  const data = retryData.get(tabId) || { count: 0, timestamp: Date.now() };
  
  // 最多重试 5 次，之后停止，避免网站真挂了还一直刷
  if (data.count >= 5) {
    console.log(`[论坛恢复] Tab ${tabId} 已连续失败 5 次，停止自动刷新。请手动检查网络或论坛是否宕机。`);
    retryData.delete(tabId);
    return;
  }
  
  // 指数退避：第1次等3秒，第2次6秒，第3次12秒，第4次24秒，第5次48秒
  const delayMs = 3000 * Math.pow(2, data.count);
  data.count += 1;
  data.timestamp = Date.now();
  retryData.set(tabId, data);
  
  console.log(`[论坛恢复] ${reason} | Tab ${tabId} 将在 ${delayMs/1000} 秒后刷新 (第${data.count}次重试)`);
  
  setTimeout(() => {
    chrome.tabs.reload(tabId, { bypassCache: true }, () => {
      if (chrome.runtime.lastError) {
        console.error('[论坛恢复] 刷新失败:', chrome.runtime.lastError.message);
      }
    });
  }, delayMs);
}

// ============================================
// 方案1：监听网络导航错误（最及时，页面还没完全变成错误页就触发）
// ============================================
chrome.webNavigation.onErrorOccurred.addListener((details) => {
  // frameId === 0 表示主页面，忽略 iframe 里的错误
  if (details.frameId !== 0) return;
  
  // 只处理目标论坛
  if (!isTargetUrl(details.url)) return;
  
  console.log(`[论坛恢复] 网络错误: ${details.error} | URL: ${details.url}`);
  scheduleReload(details.tabId, `网络错误: ${details.error}`);
});

// ============================================
// 方案2：监听标签页变化（兜底，防止方案1漏掉）
// ============================================
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 当页面变成错误页面时
  if ((changeInfo.url || changeInfo.title || changeInfo.status === 'complete') 
      && isErrorPage(tab.url, tab.title)) {
    
    // 进一步确认是网络类错误（而不是 404 之类的）
    const isNetworkError = tab.title && (
      tab.title.includes('ERR_') ||
      tab.title.includes('无法访问') ||
      tab.title.includes('未连接到互联网') ||
      tab.title.includes('No internet') ||
      tab.title.includes('无法访问此网站')
    );
    
    if (isNetworkError) {
      console.log(`[论坛恢复] 检测到错误页面: "${tab.title}"`);
      scheduleReload(tabId, `错误页面: ${tab.title}`);
    }
  }
  
  // 页面成功加载了，清除这个标签页的重试计数
  if (changeInfo.status === 'complete' && isTargetUrl(tab.url)) {
    if (retryData.has(tabId)) {
      console.log(`[论坛恢复] Tab ${tabId} 加载成功，清除重试计数`);
      retryData.delete(tabId);
    }
  }
});

// ============================================
// 启动日志
// ============================================
console.log('[论坛恢复] 扩展已启动，正在监控网络错误...');
if (TARGET_DOMAINS.length > 0) {
  console.log('[论坛恢复] 监控域名:', TARGET_DOMAINS.join(', '));
} else {
  console.log('[论坛恢复] ⚠️ 未配置目标域名，将对所有网站生效。建议修改 TARGET_DOMAINS');
}
