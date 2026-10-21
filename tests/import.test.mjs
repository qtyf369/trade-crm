// 生成一份导入测试 Excel（复用官方导出模板表头），并验证 /api/import 闭环
const BASE = 'http://127.0.0.1:8000';

// 先用导出接口拿到真实模板，确保表头完全一致
const ex = await fetch(BASE + '/api/export');
const buf = Buffer.from(await ex.arrayBuffer());
console.log('模板大小:', buf.length, 'bytes');

// 直接上传这份导出文件（导出的数据本身可再导入，且已存在的公司会被跳过）
const fd = new FormData();
fd.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'crm_export.xlsx');
const r = await fetch(BASE + '/api/import', { method: 'POST', body: fd });
const body = await r.json().catch(() => null);
console.log('import status:', r.status);
console.log('import body:', JSON.stringify(body));

if (r.status !== 200) { console.log('FAIL: 导入失败'); process.exit(1); }
if (body.total !== 352) { console.log(`FAIL: total 应为 352，实际 ${body.total}`); process.exit(1); }
if (body.skipped !== 352) { console.log(`FAIL: 已存在的应全部跳过(352)，实际 ${body.skipped}`); process.exit(1); }
if (body.imported !== 0) { console.log(`FAIL: 不应新增，实际 ${body.imported}`); process.exit(1); }

// 确认没有产生重复公司
const all = await (await fetch(BASE + '/api/customers?page=1&page_size=500')).json();
const names = all.items.map(c => c.company);
const dup = names.filter((n, i) => names.indexOf(n) !== i);
if (dup.length) { console.log('FAIL: 出现重复公司', dup.slice(0, 5)); process.exit(1); }
if (all.total !== 352) { console.log(`FAIL: 导入后总数应仍为 352，实际 ${all.total}`); process.exit(1); }

console.log('\nPASS  Excel 导入闭环：模板识别正确、已存在公司全部跳过、无重复数据');
