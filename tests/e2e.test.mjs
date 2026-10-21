// 端到端交互测试：模拟真实用户操作全流程
// 用无头 Chrome 的 remote debugging 协议太复杂，这里直接调同一套 API 模拟前端行为
const BASE = 'http://127.0.0.1:8000';
const results = [];
const check = (name, cond, detail) => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -> ' + detail : ''}`);
};

// ---- 场景1：用户在"新增客户"填表并保存（含多联系人） ----
const newCustomer = {
  company: '__E2E_测试贸易公司__',
  contact: '王小明',
  country: '德国',
  email: 'wang@example.com',
  phone: '+49 111 2222',
  source: '展会',
  level: 'L3',
  status: 'contacted',
  note: 'E2E 测试备注',
  products: '不锈钢餐具',
  contacts: [
    { name: '王小明', email: 'wang@example.com', phone: '+49 111 2222', social: 'whatsapp', socialAccount: '+491112222', position: '采购经理' },
    { name: '李小红', email: 'li@example.com', phone: '+49 333 4444', social: '', socialAccount: '', position: '老板' },
  ],
};
let r = await fetch(`${BASE}/api/customers`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCustomer),
});
let b = await r.json();
check('新增客户(多联系人)', r.status === 200 && b.id, b.id);
const cid = b.id;

// ---- 场景2：列表里能搜到（前端搜索走同一参数） ----
r = await fetch(`${BASE}/api/customers?search=__E2E_测试贸易公司__`);
b = await r.json();
check('搜索能命中新客户', b.total === 1 && b.items[0].id === cid, `total=${b.total}`);
check('返回的联系人数组完整', b.items[0].contacts.length === 2, `${b.items[0].contacts.length} 个联系人`);
check('社交账号字段保留', b.items[0].contacts[0].socialAccount === '+491112222');
check('职位字段保留', b.items[0].contacts[1].position === '老板');

// ---- 场景3：添加跟进记录（自定义时间 + 下次跟进） ----
r = await fetch(`${BASE}/api/followups`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customer_id: cid, type: 'visit', content: 'E2E 拜访记录：已看厂',
    next_follow_up_at: '2026-12-01', created_at: '2026-10-20T09:15',
  }),
});
b = await r.json();
check('添加跟进记录', r.status === 200 && b.id, b.id);
const fid = b.id;

// ---- 场景4：详情页能看到跟进，且"最近跟进"列更新 ----
r = await fetch(`${BASE}/api/customers/${cid}/detail`);
b = await r.json();
check('详情含跟进记录', b.followups.length === 1 && b.followups[0].id === fid);
check('跟进内容正确', b.followups[0].content === 'E2E 拜访记录：已看厂');
check('跟进时间已规范化', b.followups[0].created_at === '2026-10-20 09:15:00', b.followups[0].created_at);
check('下次跟进为日期格式', b.followups[0].next_follow_up_at === '2026-12-01', b.followups[0].next_follow_up_at);

r = await fetch(`${BASE}/api/customers?search=__E2E_测试贸易公司__`);
b = await r.json();
check('最近跟进时间已更新', b.items[0].last_followup_at === '2026-10-20 09:15:00', b.items[0].last_followup_at);

// ---- 场景5：编辑跟进记录 ----
r = await fetch(`${BASE}/api/followups/${fid}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ customer_id: cid, type: 'phone', content: 'E2E 已修改的跟进', next_follow_up_at: '2026-12-15' }),
});
check('编辑跟进记录', r.status === 200);
r = await fetch(`${BASE}/api/followups?customer_id=${cid}`);
b = await r.json();
check('编辑已生效', b.items[0].content === 'E2E 已修改的跟进' && b.items[0].type === 'phone');
check('原时间未被清空', b.items[0].created_at === '2026-10-20 09:15:00', b.items[0].created_at);

// ---- 场景6：批量加星标后取消 ----
r = await fetch(`${BASE}/api/customers/batch`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ids: [cid], action: 'star' }),
});
check('批量加星标', r.status === 200);
r = await fetch(`${BASE}/api/customers?starred=true&search=__E2E_测试贸易公司__`);
b = await r.json();
check('星标筛选中可见', b.total === 1);
r = await fetch(`${BASE}/api/customers/batch`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ids: [cid], action: 'unstar' }),
});
check('批量取消星标', r.status === 200);

// ---- 场景7：按筛选条件导出 ----
r = await fetch(`${BASE}/api/export?ids=${cid}`);
check('按 id 导出', r.status === 200 && (r.headers.get('content-type') || '').includes('sheet'));
const buf = Buffer.from(await r.arrayBuffer());
check('导出文件非空', buf.length > 3000, `${buf.length} bytes`);

// ---- 场景8：删除客户，跟进一并清除 ----
r = await fetch(`${BASE}/api/customers/${cid}`, { method: 'DELETE' });
check('删除客户', r.status === 200);
r = await fetch(`${BASE}/api/followups?customer_id=${cid}`);
b = await r.json();
check('跟进记录一并删除', b.total === 0, `剩余 ${b.total}`);
r = await fetch(`${BASE}/api/customers?search=__E2E_测试贸易公司__`);
b = await r.json();
check('列表中已消失', b.total === 0);

// ---- 场景9：数据完整性：总数恢复 352 ----
r = await fetch(`${BASE}/api/customers?page=1&page_size=1`);
b = await r.json();
check('客户总数恢复 352', b.total === 352, `total=${b.total}`);

console.log('\n===== 汇总 =====');
const failed = results.filter((x) => !x.pass);
console.log(`通过 ${results.length - failed.length}/${results.length}`);
if (failed.length) { console.log('失败:', failed.map((f) => f.name).join(' | ')); process.exitCode = 1; }
