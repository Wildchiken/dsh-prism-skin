/**
 * 首屏注入：host 半在每次渲染 index.html 时塞进去的内容。
 *
 * 宿主的 token 样式表要等插件加载完才出现，而宿主的 index.css 里有
 * `body{background:var(--dsw-alias-bg-base,#fff)}`：变量还没定义的那段时间 body 是白的。
 * 所以分两步，保证从 body 出现的第一刻起颜色就对：
 *
 *   1. `<head>` 里放一段 `<style>`，选择器 `body:not(#prism-boot)` 的优先级高过宿主的
 *      token 表，亮暗各一份（暗色跟着 `body[data-ds-dark-theme]` 走），不需要任何脚本；
 *   2. `<body>` 开头的脚本把这段样式转成 body 的行内变量（客户端接手后 `overrideTokens`
 *      写入的就是同一批），然后删掉这段样式。以后换主题、回到宿主默认都只动行内变量。
 *
 * 变量值只有引擎生成的颜色和清洗过的覆盖值（不含 `; { } < > \`），不会跳出声明或标签。
 */

/** 浏览器全局变量名：首屏数据。 */
export const BOOT_GLOBAL = '__DSH_PRISM_BOOT__'

/** 自定义 CSS 的 style 标签以这段注释开头，客户端靠它认出首屏注入的那个标签并接管。 */
export const CSS_MARK = '/*prism-css*/'

/** 首屏样式的两条选择器。`#prism-boot` 只用来抬高优先级，页面上没有这个元素。 */
const LIGHT_SELECTOR = 'body:not(#prism-boot)'
const DARK_SELECTOR = 'body[data-ds-dark-theme]:not(#prism-boot)'

/**
 * 首屏脚本：找到上面那段样式，转成行内变量，把紧凑形式留给客户端，再删掉样式。
 * 明暗看宿主主题脚本设好的 `data-ds-dark-theme`；万一宿主脚本还没跑，退回系统偏好。
 */
const BOOT_SCRIPT = `(function(){try{var b=globalThis.${BOOT_GLOBAL};if(!b)return;var s=document.getElementsByTagName("style"),el=null,k=0;for(;k<s.length;k++)if(s[k].textContent.indexOf("${LIGHT_SELECTOR}{")===0){el=s[k];break}if(!el)return;var p=el.textContent.split("}"),t={},m=0,j,d,c,n;for(;m<2;m++){d=p[m].slice(p[m].indexOf("{")+1).split(";");for(j=0;j<d.length;j++){c=d[j].indexOf(":");if(c<1)continue;n=d[j].slice(0,c);(t[n]=t[n]||["",""])[m]=d[j].slice(c+1)}}b.tokens=t;var y=document.body,e=document.documentElement,i=y.hasAttribute("data-ds-dark-theme")||(!e.hasAttribute("data-ds-theme-source")&&matchMedia("(prefers-color-scheme: dark)").matches)?1:0;var o=b.layer&&b.layer.o,w=b.doc&&b.doc.keys&&b.doc.keys.power,p=w&&w.v,r=o&&(p==="on"||p!=="off"&&matchMedia("(prefers-reduced-transparency: reduce)").matches);for(n in t)y.style.setProperty(n,(r&&o[n]?o[n]:t[n])[i]);el.parentNode.removeChild(el);b.at=performance.now()}catch(x){}})()`

/**
 * 宿主首屏样式把 body 背景写死成纯白或 #151517。改成跟随变量：
 * 没有主题时 `--dsw-alias-bg-base` 未定义，回退到宿主自己的 `--dsh-boot-bg`。
 */
const BOOT_STYLE = 'body{background-color:var(--dsw-alias-bg-base,var(--dsh-boot-bg,Canvas))}'

/**
 * @param {Record<string, {light: string, dark: string}> | null} tokens 变量
 * @returns {Record<string, [string, string]> | null} 紧凑形式（少一半 JSON）
 */
export function packTokens(tokens) {
  if (tokens === null) return null
  /** @type {Record<string, [string, string]>} */
  const packed = {}
  for (const [name, value] of Object.entries(tokens)) packed[name] = [value.light, value.dark]
  return packed
}

/**
 * @param {Record<string, [string, string]> | null | undefined} packed 紧凑形式
 * @returns {Record<string, {light: string, dark: string}> | null} 变量
 */
export function unpackTokens(packed) {
  if (packed === null || packed === undefined) return null
  /** @type {Record<string, {light: string, dark: string}>} */
  const tokens = {}
  for (const name of Object.keys(packed)) tokens[name] = { light: packed[name][0], dark: packed[name][1] }
  return tokens
}

/**
 * @typedef {{tokens: Record<string, {light: string, dark: string}> | null, opaque: Record<string, {light: string, dark: string}> | null, wall: object | null}} Layer
 */

/**
 * @param {Layer} layer 一层变量
 * @returns {{t: unknown, o: unknown, w: object | null}} 传输用的紧凑形式
 */
export const packLayer = (layer) => ({ t: packTokens(layer.tokens), o: packTokens(layer.opaque), w: layer.wall })

/**
 * @param {any} packed 紧凑形式
 * @returns {Layer} 一层变量
 */
export const unpackLayer = (packed) => ({ tokens: unpackTokens(packed?.t), opaque: unpackTokens(packed?.o), wall: packed?.w ?? null })

/**
 * 省电时（含系统「减少透明度」），把玻璃那部分换成不透明纯色。
 * @param {Layer} layer 一层变量
 * @param {boolean} reduce 是否省电
 * @returns {Layer['tokens']} 实际要用的变量
 */
export const effectiveTokens = (layer, reduce) => (reduce && layer.tokens !== null && layer.opaque !== null ? { ...layer.tokens, ...layer.opaque } : layer.tokens)

/**
 * 首屏样式文本。
 * @param {Record<string, {light: string, dark: string}> | null} tokens 变量
 * @returns {string | null} CSS；没有变量时为 null
 */
export function bootStyleText(tokens) {
  if (tokens === null) return null
  let light = ''
  let dark = ''
  for (const [name, value] of Object.entries(tokens)) {
    light += `${name}:${value.light};`
    dark += `${name}:${value.dark};`
  }
  return `${LIGHT_SELECTOR}{${light}}${DARK_SELECTOR}{${dark}}`
}

/**
 * 生成 index 注入行。
 * @param {{doc: unknown, version: string, layer: Layer, css?: string}} payload 首屏数据；css 是已经检查过的自定义 CSS
 * @returns {object[]} 注入行
 */
export function bootRows({ doc, version, layer, css = '' }) {
  const { tokens } = layer
  const rows = [{ kind: 'style', text: BOOT_STYLE }]
  const style = bootStyleText(tokens)
  if (style !== null) rows.push({ kind: 'style', text: style })
  if (css !== '') rows.push({ kind: 'style', text: CSS_MARK + css })
  rows.push({ kind: 'global', name: BOOT_GLOBAL, value: { doc, version, layer: { o: packTokens(layer.opaque), w: layer.wall } } })
  rows.push({ kind: 'script', placement: 'body', text: BOOT_SCRIPT })
  return rows
}
