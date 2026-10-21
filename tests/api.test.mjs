const BASE = 'http://127.0.0.1:8000';

async function j(path, opts) {
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: r.status, body };
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
}

// 1. 分页列表
let r = await j('/api/customers?page=1&page_size=5');
check('分页列表 200', r.status === 200);
check('返回 items/total/page/page_size',
  r.body && Array.isArray(r.body.items) && typeof r.body.total === 'number',
  `total=${r.body.total}, items=${r.body.items.length}`);
check('字段已规范化(data_issues为数组)',
  r.body.items[0] && Array.isArray(r.body.items[0].data_issues),
  JSON.stringify(r.body.items[0].data_issues));
check('created_at 格式统一',
  r.body.items.every(c => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(c.created_at || '')),
  r.body.items[0] && r.body.items[0].created_at);

// 2. 搜索
r = await j('/api/customers?search=EuroSteel');
check('搜索公司名', r.body.items.length === 1 && r.body.items[0].company === 'EuroSteel GmbH',
  `命中 ${r.body.items.length}`);
r = await j('/api/customers?search=zzznotexist');
check('搜索无结果', r.body.total === 0, `total=${r.body.total}`);

// 3. 筛选
r = await j('/api/customers?status=deal&page_size=500');
check('状态筛选', r.body.items.every(c => c.status === 'deal'), `命中 ${r.body.total}`);
r = await j('/api/customers?level=L3&page_size=500');
check('等级筛选', r.body.items.every(c => c.level === 'L3'), `命中 ${r.body.total}`);
r = await j('/api/customers?starred=true&page_size=500');
check('星标筛选', r.body.items.every(c => Number(c.starred) === 1), `命中 ${r.body.total}`);
r = await j('/api/customers?issues=true&page_size=500');
check('问题数据筛选', r.body.items.every(c => c.data_issues.length > 0), `命中 ${r.body.total}`);

// 4. 排序
r = await j('/api/customers?sort_by=company&sort_asc=true&page_size=10');
const asc = r.body.items.map(c => c.company);
check('按公司升序', JSON.stringify(asc) === JSON.stringify([...asc].sort((a,b)=>a.localeCompare(b,'zh'))),
  asc.slice(0,3).join(' | '));
r = await j('/api/customers?sort_by=company&sort_asc=false&page_size=3');
const desc = r.body.items.map(c => c.company);
check('按公司降序', desc[0] >= desc[desc.length-1]);

// 5. 详情
r = await j('/api/customers/c1/detail');
check('客户详情', r.status === 200 && r.body.customer && Array.isArray(r.body.followups),
  `跟进 ${r.body.followups ? r.body.followups.length : 0} 条`);

// 6. 全量兼容接口
r = await j('/api/customers/all');
check('兼容接口 /all 返回数组', Array.isArray(r.body), `共 ${r.body.length} 条`);

// 7. 批量接口（不污染真实数据：用星标切换后还原）
r = await j('/api/customers?page_size=3');
const ids = r.body.items.map(c => c.id);
let br = await j('/api/customers/batch', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ ids, action: 'star' }),
});
check('批量加星标', br.status === 200 && br.body.affected === ids.length, JSON.stringify(br.body));
br = await j(`/api/customers?starred=true&page_size=500`);
check('星标已生效', br.body.items.filter(c => ids.includes(c.id)).length === ids.length);
br = await j('/api/customers/batch', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ ids, action: 'unstar' }),
});
check('批量取消星标', br.status === 200 && br.body.affected === ids.length);

// 8. 新建客户 -> 校验问题 -> 更新 -> 删除
const payload = {
  company: '__TEST_临时客户__', contact: '测试', country: 'usa',
  email: 'test@example.com', phone: '123', source: '展会',
  level: 'L2', status: 'deal', note: '', products: '测试',
  contacts: [{ name: '测试', email: 'test@example.com', phone: '123', social: 'wechat', socialAccount: 'wx1', position: '经理' }],
};
let cr = await j('/api/customers', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
check('新建客户', cr.status === 200 && cr.body.id, JSON.stringify(cr.body));
const newId = cr.body.id;
r = await j(`/api/customers/${newId}/detail`);
check('国家 usa 已转中文', r.body.customer.country === '美国', r.body.customer.country);
check('data_issues 已计算', Array.isArray(r.body.customer.data_issues), JSON.stringify(r.body.customer.data_issues));
let ur = await j(`/api/customers/${newId}`, { method: 'PUT', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ ...payload, country: '德国', level: 'L4', status: 'negotiating' }) });
check('更新客户', ur.status === 200);
r = await j(`/api/customers/${newId}/detail`);
check('更新后字段正确', r.body.customer.country === '德国' && r.body.customer.level === 'L4' && r.body.customer.status === 'negotiating',
  `${r.body.customer.country}/${r.body.customer.level}/${r.body.customer.status}`);
check('联系人未丢失', r.body.customer.contacts.length === 1 && r.body.customer.contacts[0].socialAccount === 'wx1',
  JSON.stringify(r.body.customer.contacts));
let dr = await j(`/api/customers/${newId}`, { method: 'DELETE' });
check('删除客户', dr.status === 200);
r = await j(`/api/customers/${newId}/detail`);
check('删除后 404', r.status === 404);

// 9. 跟进记录
let fr = await j('/api/followups?page_size=3');
check('跟进记录分页', fr.status === 200 && Array.isArray(fr.body.items), `total=${fr.body.total}`);
fr = await j('/api/followups?customer_id=c1&page_size=500');
check('按客户过滤跟进', fr.body.items.every(f => f.customer_id === 'c1'), `命中 ${fr.body.total}`);
const newFu = { customer_id: 'c1', type: 'phone', content: '__API_TEST__', next_follow_up_at: '2026-11-01', created_at: '2026-10-21T14:30' };
fr = await j('/api/followups', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(newFu) });
check('新建跟进(自定义时间)', fr.status === 200 && fr.body.id, JSON.stringify(fr.body));
const fuId = fr.body.id;
fr = await j(`/api/followups?customer_id=c1&page_size=500`);
const created = fr.body.items.find(f => f.id === fuId);
check('时间格式已规范化', created && created.created_at === '2026-10-21 14:30:00', created && created.created_at);
check('下次跟进为日期', created && created.next_follow_up_at === '2026-11-01', created && created.next_followup_at || created && created.next_follow_up_at);
fr = await j(`/api/followups/${fuId}`, { method: 'DELETE' });
check('删除跟进', fr.status === 200);
fr = await j(`/api/followups?customer_id=c1&page_size=500`);
check('删除后不存在', !fr.body.items.some(f => f.id === fuId));

// 10. 导出
const ex = await fetch(BASE + '/api/export');
check('导出 Excel', ex.status === 200 && (ex.headers.get('content-type') || '').includes('sheet'),
  ex.headers.get('content-type'));
const exSearch = await fetch(BASE + '/api/export?search=EuroSteel');
check('导出带搜索条件', exSearch.status === 200);

// 11. 国家修正接口
r = await j('/api/fix/countries', { method: 'POST' });
check('国家修正接口', r.status === 200, JSON.stringify(r.body));

// 12. 同步配置（不发起真实网络请求）
r = await j('/api/sync/config');
check('同步配置不泄露密码', r.status === 200 && r.body.webdav_pass_saved === true && !('webdav_pass' in r.body),
  JSON.stringify(r.body));

console.log('\n===== 汇总 =====');
const failed = results.filter(x => !x.pass);
console.log(`通过 ${results.length - failed.length}/${results.length}`);
if (failed.length) { console.log('失败项:', failed.map(f => f.name).join(', ')); process.exitCode = 1; }
