/**
 *Lunes Host 自动登录脚本
 *用于 GitHub Action 每天零点自动登录
 * 
 *基于 HAR 文件分析:
 *- 目标网站: https://betadash.lunes.host
 *- 使用 Cloudflare 保护 (cf_clearance)
 *- Session 管理
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ============== 配置区域 (请修改以下配置) ==============
const CONFIG = {
  // 登录页面 URL
  loginUrl: process.env.LOGIN_URL || 'https://betadash.lunes.host/login',
  
  // 登录 API 端点 (POST 到 /login)
  loginApiUrl: process.env.LOGIN_API_URL || 'https://betadash.lunes.host/login',
  
  // 登录后跳转的页面
  dashboardUrl: process.env.DASHBOARD_URL || 'https://betadash.lunes.host/dashboard',
  
  // 登录后要访问的页面 (用于保持会话)
  keepAliveUrl: process.env.KEEP_ALIVE_URL || 'https://betadash.lunes.host/cdn-cgi/rum',
  
  // 邮箱 (使用环境变量或在 GitHub Secrets 中配置)
  email: process.env.LOGIN_EMAIL || '',
  
  // 密码 (使用环境变量或在 GitHub Secrets 中配置)
  password: process.env.LOGIN_PASSWORD || '',
  
  // 请求超时 (毫秒)
  timeout: 30000,
  
  // 是否启用调试日志
  debug: process.env.DEBUG === 'true',
  
  // Cloudflare cookies (如果需要预填充)
  cfClearance: process.env.CF_CLEARANCE || '',
  sessionCookie: process.env.SESSION_COOKIE || ''
};

// 日志函数
const log = {
  info: (...args) => console.log(`[${new Date().toISOString()}] ℹ`, ...args),
  success: (...args) => console.log(`[${new Date().toISOString()}] ✅`, ...args),
  warn: (...args) => console.warn(`[${new Date().toISOString()}] ⚠️`, ...args),
  error: (...args) => console.error(`[${new Date().toISOString()}] ❌`, ...args),
  debug: (...args) => {
    if (CONFIG.debug) console.log(`[${new Date().toISOString()}] 🔍`, ...args);
  }
};

/**
 * 发起 HTTP/HTTPS 请求
 */
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const defaultOptions = {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.6,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
      },
      timeout: CONFIG.timeout
    };

    const requestOptions = {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...options.headers
      }
    };

    if (CONFIG.debug) {
      log.debug('Request URL:', url);
      log.debug('Request Options:', JSON.stringify(requestOptions, null, 2));
    }

    const req = client.request(url, requestOptions, (res) => {
      // 收集响应数据
      const chunks = [];
      
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        const cookies = parseCookies(res.headers['set-cookie']);
        
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body,
          cookies: cookies
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    // 写入请求体
    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

/**
 * 解析 Set-Cookie 头
 */
function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders || !Array.isArray(setCookieHeaders)) {
    return {};
  }

  const cookies = {};
  setCookieHeaders.forEach(cookieString => {
    const parts = cookieString.split(';');
    const [nameValue] = parts;
    const [name, value] = nameValue.split('=');
    if (name && value) {
      cookies[name.trim()] = value.trim();
    }
  });
  return cookies;
}

/**
 * 构建 Cookie 字符串
 */
function buildCookieString(cookies) {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/**
 * 执行登录
 */
async function login() {
  log.info('🚀 开始登录流程...');
  log.info(`目标网站: ${CONFIG.loginUrl}`);

  let cookies = {};

  // 如果有预填充的 Cloudflare cookie
  if (CONFIG.cfClearance) {
    cookies['cf_clearance'] = CONFIG.cfClearance;
    log.info('使用预填充的 cf_clearance cookie');
  }
  
  if (CONFIG.sessionCookie) {
    cookies['session'] = CONFIG.sessionCookie;
    log.info('使用预填充的 session cookie');
  }

  try {
    // Step 1: 访问登录页面获取初始 cookie
    log.info('📋 步骤 1: 访问登录页面...');
    const loginPage = await request(CONFIG.loginUrl, {
      method: 'GET',
      headers: {
        'Cookie': buildCookieString(cookies)
      }
    });

    // 合并新的 cookies
    cookies = { ...cookies, ...loginPage.cookies };
    log.debug('登录页面状态:', loginPage.statusCode);

    // 检查是否被 Cloudflare 拦截
    if (loginPage.statusCode === 403 || loginPage.body.includes('Cloudflare')) {
      log.error('🚫 检测到 Cloudflare 挑战，需要手动处理 cf_clearance');
      log.info('请在本地浏览器完成验证后，获取 cf_clearance cookie 并设置为环境变量');
      throw new Error('Cloudflare protection active');
    }

    // Step 2: 发送登录请求
    log.info('🔐 步骤 2: 提交登录表单...');
    
    const loginData = new URLSearchParams({
      email: CONFIG.email,
      password: CONFIG.password,
      next: '/'
    }).toString();

    const loginResponse = await request(CONFIG.loginApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': buildCookieString(cookies),
        'Referer': CONFIG.loginUrl,
        'Origin': new URL(CONFIG.loginUrl).origin
      },
      body: loginData
    });

    // 合并登录后的 cookies
    cookies = { ...cookies, ...loginResponse.cookies };
    log.debug('登录响应状态:', loginResponse.statusCode);

    // 检查登录结果
    if (loginResponse.statusCode >= 200 && loginResponse.statusCode < 300) {
      log.success('✅ 登录成功!');
    } else if (loginResponse.statusCode === 401) {
      log.error('❌ 用户名或密码错误');
      throw new Error('Authentication failed');
    } else {
      log.warn('⚠️ 登录响应状态:', loginResponse.statusCode);
    }

    // Step 3: 访问需要认证的页面验证登录
    log.info('✅ 步骤 3: 验证登录状态...');
    const verifyResponse = await request(CONFIG.keepAliveUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': buildCookieString(cookies),
        'Referer': CONFIG.loginUrl,
        'Origin': new URL(CONFIG.loginUrl).origin
      },
      body: JSON.stringify({
        eventType: 1,
        location: CONFIG.loginUrl,
        referrer: CONFIG.loginUrl
      })
    });

    if (verifyResponse.statusCode >= 200 && verifyResponse.statusCode < 400) {
      log.success('✅ 登录验证成功，会话有效');
    } else {
      log.warn('⚠️ 验证响应状态:', verifyResponse.statusCode);
    }

    // 输出最终 cookies (可用于调试)
    log.debug('最终 cookies:', JSON.stringify(cookies, null, 2));

    return {
      success: true,
      cookies: cookies,
      message: 'Login successful'
    };

  } catch (error) {
    log.error('❌ 登录失败:', error.message);
    return {
      success: false,
      cookies: cookies,
      message: error.message
    };
  }
}

/**
 * 主函数
 */
async function main() {
  log.info('='.repeat(50));
  log.info('Lunes Host 自动登录脚本');
  log.info('执行时间:', new Date().toISOString());
  log.info('='.repeat(50));

  // 检查必要配置
  if (!CONFIG.email || !CONFIG.password) {
    log.error('❌ 请配置 LOGIN_EMAIL 和 LOGIN_PASSWORD 环境变量');
    log.info('设置环境变量命令:');
    log.info('  export LOGIN_EMAIL=your_email@example.com');
    log.info('  export LOGIN_PASSWORD=your_password');
    process.exit(1);
  }

  const result = await login();

  if (result.success) {
    log.success('🎉 登录流程完成!');
    process.exit(0);
  } else {
    log.error('💥 登录流程失败!');
    process.exit(1);
  }
}

// 导出模块 (用于测试或在其他脚本中调用)
module.exports = { login, CONFIG };

// 直接运行
if (require.main === module) {
  main().catch(error => {
    log.error('未捕获的错误:', error);
    process.exit(1);
  });
}
