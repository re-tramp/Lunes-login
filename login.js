const https = require('https');
const http = require('http');
const { URL } = require('url');

const CONFIG = {
  loginUrl: process.env.LOGIN_URL || 'https://betadash.lunes.host/login',
  loginApiUrl: process.env.LOGIN_API_URL || 'https://betadash.lunes.host/login',
  dashboardUrl: process.env.DASHBOARD_URL || 'https://betadash.lunes.host/dashboard',
  keepAliveUrl: process.env.KEEP_ALIVE_URL || 'https://betadash.lunes.host/cdn-cgi/rum',
  email: process.env.LOGIN_EMAIL || '',
  password: process.env.LOGIN_PASSWORD || '',
  timeout: 30000,
  debug: process.env.DEBUG === 'true',
  cfClearance: process.env.CF_CLEARANCE || '',
  sessionCookie: process.env.SESSION_COOKIE || '',
  telegram: {
    enabled: !!(process.env.TG_BOT_TOKEN && process.env.TG_CHAT_ID),
    botToken: process.env.TG_BOT_TOKEN || '',
    chatId: process.env.TG_CHAT_ID || ''
  }
};

const log = {
  info: (...args) => console.log(`[${new Date().toISOString()}] ℹ`, ...args),
  success: (...args) => console.log(`[${new Date().toISOString()}] ✅`, ...args),
  warn: (...args) => console.warn(`[${new Date().toISOString()}] ⚠️`, ...args),
  error: (...args) => console.error(`[${new Date().toISOString()}] ❌`, ...args),
  debug: (...args) => {
    if (CONFIG.debug) console.log(`[${new Date().toISOString()}] 🔍`, ...args);
  }
};

async function sendTelegramNotification(message, isError = false) {
  if (!CONFIG.telegram.enabled) {
    log.debug('Telegram 通知未启用');
    return;
  }

  const emoji = isError ? '🔴' : '🟢';
  const text = `*Lunes Login ${isError ? 'Failed' : 'Success'}* ${emoji}\n\n` +
    `\`${message}\`\n\n` +
    `⏰ Time: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;

  const postData = JSON.stringify({
    chat_id: CONFIG.telegram.chatId,
    text: text,
    parse_mode: 'Markdown'
  });

  return new Promise((resolve) => {
    const req = https.request(`https://api.telegram.org/bot${CONFIG.telegram.botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        if (res.statusCode === 200) {
          log.info('📱 Telegram 通知已发送');
          resolve(true);
        } else {
          log.warn('⚠️ Telegram 通知失败:', body);
          resolve(false);
        }
      });
    });
    
    req.on('error', (err) => {
      log.warn('⚠️ Telegram 请求错误:', err.message);
      resolve(false);
    });
    
    req.write(postData);
    req.end();
  });
}

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

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

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

function buildCookieString(cookies) {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function login() {
  log.info('🚀 开始登录流程...');
  log.info(`目标网站: ${CONFIG.loginUrl}`);

  let cookies = {};

  if (CONFIG.cfClearance) {
    cookies['cf_clearance'] = CONFIG.cfClearance;
    log.info('使用预填充的 cf_clearance cookie');
  }
  
  if (CONFIG.sessionCookie) {
    cookies['session'] = CONFIG.sessionCookie;
    log.info('使用预填充的 session cookie');
  }

  try {
    log.info('📋 步骤 1: 访问登录页面...');
    const loginPage = await request(CONFIG.loginUrl, {
      method: 'GET',
      headers: {
        'Cookie': buildCookieString(cookies)
      }
    });

    cookies = { ...cookies, ...loginPage.cookies };
    log.debug('登录页面状态:', loginPage.statusCode);

    if (loginPage.statusCode === 403 || loginPage.body.includes('Cloudflare')) {
      log.error('🚫 检测到 Cloudflare 挑战，需要手动处理 cf_clearance');
      log.info('请在本地浏览器完成验证后，获取 cf_clearance cookie 并设置为环境变量');
      throw new Error('Cloudflare protection active');
    }

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

    cookies = { ...cookies, ...loginResponse.cookies };
    log.debug('登录响应状态:', loginResponse.statusCode);

    if (loginResponse.statusCode >= 200 && loginResponse.statusCode < 300) {
      log.success('✅ 登录成功! 状态：', loginResponse.statusCode);
    } else if (loginResponse.statusCode === 401) {
      log.error('❌ 用户名或密码错误');
      throw new Error('Authentication failed');
    } else {
      log.warn('⚠️ 登录响应状态:', loginResponse.statusCode);
    }

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

async function main() {
  log.info('='.repeat(50));
  log.info('Lunes Host 自动登录脚本');
  log.info('执行时间:', new Date().toISOString());
  log.info('='.repeat(50));

  if (!CONFIG.email || !CONFIG.password) {
    log.error('❌ 请配置 LOGIN_EMAIL 和 LOGIN_PASSWORD 环境变量');
    log.info('设置环境变量命令:');
    log.info('  export LOGIN_EMAIL=your_email@example.com');
    log.info('  export LOGIN_PASSWORD=your_password');
    process.exit(1);
  }

  const result = await login();

  if (result.success) {
    await sendTelegramNotification('✅ 登录成功! 会话已保持', false);
  } else {
    await sendTelegramNotification(`❌ 登录失败: ${result.message}`, true);
  }

  if (result.success) {
    log.success('🎉 登录流程完成!');
    process.exit(0);
  } else {
    log.error('💥 登录流程失败!');
    process.exit(1);
  }
}

module.exports = { login, CONFIG };

if (require.main === module) {
  main().catch(error => {
    log.error('未捕获的错误:', error);
    process.exit(1);
  });
}
