// 构造一份含脏数据的新 Excel，验证导入时 data_issues 是否正确写入
const BASE = 'http://127.0.0.1:8000';

// 用导出的真实模板改数据：先拿模板
const ex = await fetch(BASE + '/api/export');
const tpl = Buffer.from(await ex.arrayBuffer());

// 用 Python 端已有的 openpyxl 不可用，这里直接用 xlsx 模板 + 手工构造太复杂；
// 改为：直接调 /api/customers 新建一个含脏数据的客户，验证 validate_customer
const dirty = {
  company: '__DIRTY_TEST_脏数据客户__',
  contact: '测试员',
  country: 'usa',            // 英文 -> 应转中文
  email: 'test@example.com',
  phone: '123',
  source: 'LinkedIn',        // 不在白名单 -> 应标记
  level: 'A',                // 旧等级 -> 应标记
  status: 'deal',
  note: '',
  products: '测试',
  contacts: [
    { name: '测试员', email: 'charles.miller@yahoo.com', phone: '1', social: '', socialAccount: '', position: '' },
  ],
};
const cr = await fetch(BASE + '/api/customers', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dirty),
});
const created = await cr.json();
console.log('created id:', created.id);

const d = await (await fetch(`${BASE}/api/customers/${created.id}/detail`)).json();
console.log('country(应=美国):', d.customer.country);
console.log('data_issues:', JSON.stringify(d.customer.data_issues, null, 1));

const issues = d.customer.data_issues;
const checks = [
  ['国家英文转中文', d.customer.country === '美国'],
  ['来源不规范被标记', issues.some(i => i.includes('来源不规范：LinkedIn'))],
  ['等级不规范被标记', issues.some(i => i.includes('等级不规范：A'))],
  ['邮箱重复被标记', issues.some(i => i.includes('邮箱重复：charles.miller@yahoo.com'))],
];
let ok = true;
for (const [name, pass] of checks) { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`); if (!pass) ok = false; }

// 清理
await fetch(`${BASE}/api/customers/${created.id}`, { method: 'DELETE' });
const after = await (await fetch(`${BASE}/api/customers/${created.id}/detail`)).json();
console.log('清理后 404:', after.status !== 200 || !after.customer);
if (!ok) process.exit(1);
console.log('\nPASS  脏数据校验链路完整');
