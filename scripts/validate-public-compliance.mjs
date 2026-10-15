import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
// 默认校验正式站点使用的 publicCompliance.local.json；仓库内的 publicCompliance.json 只是占位模板，不会通过校验。
const defaultConfigPath = fileURLToPath(new URL('../src/app/data/publicCompliance.local.json',import.meta.url));
const placeholderPattern = /(?:待补|待填|待定|待提供|待确认|请填写|请替换|占位|示例|测试编号|placeholder|todo|tbd|x{3,}|unknown|change[-_ ]?me|replace[-_ ]?me|example\.(?:com|cn|org))/iu;

const registrationRules = {
  icp: {
    name: 'ICP备案',
    required: true,
    labelPattern: /ICP备[0-9-]+号/u,
    allowedHost: hostname => hostname === 'beian.miit.gov.cn',
  },
  publicSecurity: {
    name: '公安备案',
    required: false,
    labelPattern: /公网安备.+号/u,
    allowedHost: hostname => (
      hostname === 'beian.gov.cn'
      || hostname === 'www.beian.gov.cn'
      || hostname === 'mps.gov.cn'
      || hostname.endsWith('.mps.gov.cn')
    ),
  },
  aiApplication: {
    name: 'AI 应用登记公示',
    required: false,
    labelPattern: /(?:人工智能|AI).*(?:备案|登记|公示)/iu,
    allowedHost: isGovernmentHostname,
  },
  aiModel: {
    name: 'AI 模型备案公示',
    required: false,
    labelPattern: /(?:人工智能|AI|模型).*(?:备案|登记|公示)/iu,
    allowedHost: isGovernmentHostname,
  },
};

function isGovernmentHostname(hostname) {
  return hostname === 'gov.cn' || hostname.endsWith('.gov.cn');
}

function hasPlaceholder(value) {
  return placeholderPattern.test(value);
}

function validateRegistration(kind,registration,errors) {
  const rule = registrationRules[kind];
  if (!registration || typeof registration !== 'object' || Array.isArray(registration)) {
    if (rule.required) errors.push(`缺少${rule.name}的展示文案与链接`);
    return;
  }

  const label = typeof registration.label === 'string' ? registration.label.trim() : '';
  const urlValue = typeof registration.url === 'string' ? registration.url.trim() : '';

  if (!label) errors.push(`${rule.name}缺少展示文案`);
  else {
    if (hasPlaceholder(label)) errors.push(`${rule.name}展示文案包含占位内容`);
    if (!rule.labelPattern.test(label)) errors.push(`${rule.name}展示文案不符合备案/登记格式`);
  }

  if (!urlValue) {
    errors.push(`${rule.name}缺少公开查询链接`);
    return;
  }
  if (hasPlaceholder(urlValue)) errors.push(`${rule.name}链接包含占位内容`);

  let url;
  try {
    url = new URL(urlValue);
  } catch {
    errors.push(`${rule.name}链接不是有效 URL`);
    return;
  }

  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') errors.push(`${rule.name}链接必须使用 HTTPS`);
  if (url.username || url.password) errors.push(`${rule.name}链接不得包含账号凭据`);
  if (url.port) errors.push(`${rule.name}链接不得使用非标准端口`);
  if (!rule.allowedHost(hostname)) errors.push(`${rule.name}链接必须指向允许的政府官方网站`);
}

export function validatePublicCompliance(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['公开合规配置必须是对象'];
  }

  const companyName = typeof config.companyName === 'string' ? config.companyName.trim() : '';
  if (!companyName) errors.push('缺少运营主体名称');
  else if (hasPlaceholder(companyName)) errors.push('运营主体名称包含占位内容');

  const registrations = config.registrations;
  if (!registrations || typeof registrations !== 'object' || Array.isArray(registrations)) {
    errors.push('缺少 registrations 配置');
    return errors;
  }

  for (const kind of Object.keys(registrationRules)) {
    validateRegistration(kind,registrations[kind],errors);
  }
  return errors;
}

function readConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath,'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法读取公开合规配置：${detail}`);
  }
}

function main() {
  const configArgument = process.argv[2];
  const configPath = configArgument ? path.resolve(process.cwd(),configArgument) : defaultConfigPath;

  let config;
  try {
    config = readConfig(configPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const errors = validatePublicCompliance(config);
  if (errors.length > 0) {
    console.error('公开合规配置未通过正式双站发布门禁：');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log('公开合规配置校验通过。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) main();
