/**
 * 主题体检要走的画面。每个都从刷新后的首页开始，在页面里执行导航脚本；返回 0 表示这个画面不存在（跳过）。
 * 「示例对话」是 mock-agent.mjs 剧本造的那段（标题取自它的第一句回复）。
 * 按钮按无障碍标签找，中英文界面都写上（L 里是「英文 / 中文」两种标签）。
 */
export const SESSION = '工作区的结构'

const W = 'const w=(ms)=>new Promise(r=>setTimeout(r,ms));const $=(s)=>document.querySelector(s);const $$=(s)=>[...document.querySelectorAll(s)];'
const OPEN = `$$('[class*=_sessionRow]').find(e=>e.textContent.includes(${JSON.stringify(SESSION)}))?.click();await w(1600);`
const SCROLL = (to) => `$$('*').filter(e=>e.scrollHeight>e.clientHeight+50&&/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.getBoundingClientRect().left>280).forEach(e=>e.scrollTop=${to});await w(500);`
const CLICK = (sel) => `$(${JSON.stringify(sel)})?.click();await w(700);`
const L = {
  account: ['Account menu', '账号菜单'],
  add: ['Add files or run commands', '添加文件或调用指令'],
  views: ['View options', '视图选项'],
  search: ['Search sessions', '搜索会话'],
  right: ['Open right sidebar', '打开右侧边栏'],
  workspace: ['Choose workspace', '选择工作区'],
}
const LABEL = (k) => L[k].map((t) => `[aria-label="${t}"]`).join(',')
// 标签后面带当前值的（「访问模式，当前：…」）按开头匹配
const PREFIX = (...ts) => ts.map((t) => `[aria-label^="${t}"]`).join(',')
const SETTINGS = `$('${LABEL('account')},[data-slot="settings.launcher"] button')?.click();await w(400);$$('[role=menuitem]').find(i=>/Settings|设置/.test(i.textContent))?.click();await w(900);`
// 展开对话区里收起的工具卡片、思考过程（不碰输入框和顶栏）
const EXPAND = `for(const b of $$('[aria-expanded=false]').filter(b=>{const r=b.getBoundingClientRect();return r.left>290&&r.width>0&&!b.closest('[data-composer-card]')&&!b.closest('header')&&r.top>60}).slice(0,14)){b.click();await w(200)}`
const TRAJ = `$$('[role=tab]').find(t=>/Trajectory|轨迹/.test(t.textContent))?.click();await w(1300);`
const wrap = (body) => `(async()=>{${W}${body};return 1})()`

export const STATES = {
  home: wrap(CLICK('[class*=_newSession]')),
  chatTop: wrap(`${OPEN}${SCROLL(0)}`),
  chatMid: wrap(`${OPEN}${SCROLL('(e.scrollHeight-e.clientHeight)/2')}`),
  chatEnd: wrap(`${OPEN}${SCROLL('e.scrollHeight')}`),
  chatExpandTop: wrap(`${OPEN}${EXPAND}${SCROLL(0)}`),
  chatExpandMid: wrap(`${OPEN}${EXPAND}${SCROLL('(e.scrollHeight-e.clientHeight)/2')}`),
  traj: wrap(`${OPEN}${TRAJ}`),
  trajRow: wrap(`${OPEN}${TRAJ}$$('[class*=_row],[role=row]').filter(r=>r.getBoundingClientRect().top>150)[2]?.click();await w(800);`),
  plugins: wrap(`$$('[class*=_panelRow]')[0]?.click();await w(1600);`),
  auto: wrap(`$$('[class*=_panelRow]')[1]?.click();await w(1600);`),
  moreMenu: wrap(`$$('[class*=_panelRow]')[2]?.click();await w(800);`),
  accountMenu: wrap(CLICK(LABEL('account'))),
  addMenu: wrap(`${OPEN}${CLICK(LABEL('add'))}`),
  accessMenu: wrap(`${OPEN}${CLICK(PREFIX('Access mode', '访问模式'))}`),
  modelMenu: wrap(`${OPEN}${CLICK(PREFIX('Select model', '选择模型'))}`),
  workspaceMenu: wrap(`${CLICK('[class*=_newSession]')}${CLICK(LABEL('workspace'))}`),
  seatMenu: wrap(`${CLICK('[class*=_newSession]')}${CLICK('[class*=_seat]')}`),
  viewOptions: wrap(CLICK(LABEL('views'))),
  searchSessions: wrap(CLICK(LABEL('search'))),
  sessionMenu: wrap(`const row=$$('[class*=_sessionRow]').find(e=>e.textContent.includes(${JSON.stringify(SESSION)}));if(!row)return 0;row.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));await w(300);(row.querySelector('button[aria-label]')||row.parentElement.querySelector('button[aria-label]'))?.click();await w(700);`),
  rightSidebar: wrap(`${OPEN}${CLICK(LABEL('right'))}await w(600);`),
  quick: wrap(`${OPEN}${CLICK('.prism-quick')}`),
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`settings${i}`, wrap(`${SETTINGS}const n=$$('[class*=_navCell]');if(!n[${i}])return 0;n[${i}].click();await w(900);`)])),
}
