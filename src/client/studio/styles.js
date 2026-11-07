/**
 * 分块的样式。只用宿主的变量上色，跟着主题一起变；选择器全部是自己的 `prism-` 类，
 * 不碰宿主 DOM。悬停只动 transform 和 box-shadow，不用实时模糊。
 */
export const CSS = `
.prism-section{display:flex;flex-direction:column;width:100%;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.prism-group{display:flex;flex-direction:column;gap:12px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.prism-group:last-child{border-bottom:0}
.prism-head{display:flex;align-items:center;gap:8px;min-height:30px}
.prism-title{flex:1 1 auto;min-width:0;font-size:14px;font-weight:400;line-height:22px}
.prism-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.prism-note{display:flex;gap:8px;padding:10px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.prism-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer}
.prism-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.prism-btn:disabled{color:var(--dsw-alias-label-caption);cursor:default}
.prism-btn:focus-visible,.prism-card:focus-visible,.prism-dot:focus-visible,.prism-swatch:focus-visible,.prism-chip:focus-visible,.prism-range:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.prism-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.prism-card{display:flex;flex-direction:column;gap:6px;min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.prism-mini{position:relative;display:grid;grid-template-columns:30% 1fr;aspect-ratio:16/10;overflow:hidden;border-radius:var(--dsw-radius-md);box-shadow:0 0 0 .5px var(--dsw-alias-border-l4);transition:transform .14s var(--ds-ease-in-out),box-shadow .14s var(--ds-ease-in-out)}
.prism-card:hover .prism-mini{transform:translateY(-2px);box-shadow:0 0 0 .5px var(--dsw-alias-border-l4),0 6px 18px #00000024}
.prism-card[aria-pressed=true] .prism-mini{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary)}
.prism-mini-side{display:flex;flex-direction:column;gap:5px;padding:9px 7px}
.prism-mini-main{position:relative;display:flex;flex-direction:column;gap:5px;padding:9px 10px}
.prism-line{height:4px;border-radius:2px;opacity:.9}
.prism-mini-bubble{align-self:flex-end;width:52%;height:13px;border-radius:5px}
.prism-mini-send{position:absolute;right:8px;bottom:8px;width:14px;height:14px;border-radius:50%}
.prism-card-name{display:flex;align-items:center;gap:6px;min-width:0;padding:0 2px;color:var(--dsw-alias-label-secondary)}
.prism-card[aria-pressed=true] .prism-card-name{color:var(--dsw-alias-label-primary)}
.prism-swatches{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.prism-swatch{width:24px;height:24px;padding:0;border:0;border-radius:50%;cursor:pointer;box-shadow:inset 0 0 0 .5px #0000002e}
.prism-swatch[aria-pressed=true]{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1),0 0 0 4px var(--dsw-alias-label-primary)}
.prism-color{position:relative;width:24px;height:24px;overflow:hidden;border-radius:50%;background:conic-gradient(from 90deg,#e5484d,#e5a13c,#4cb56c,#2fa8c7,#5b6ee6,#c04fc9,#e5484d);box-shadow:inset 0 0 0 .5px #0000002e}
.prism-color input{position:absolute;inset:-6px;width:36px;height:36px;padding:0;border:0;opacity:0;cursor:pointer}
.prism-chip{height:24px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.prism-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.prism-chip[aria-pressed=true]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}
.prism-sliders{display:flex;flex-direction:column;gap:6px}
.prism-slider{display:grid;grid-template-columns:72px 1fr 34px 22px;align-items:center;gap:10px;min-height:28px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.prism-value{color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums;text-align:right}
.prism-clear{display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.prism-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.prism-range{appearance:none;-webkit-appearance:none;width:100%;height:20px;margin:0;background:transparent;cursor:pointer}
.prism-range::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:var(--prism-track,var(--dsw-alias-border-l3))}
.prism-range::-moz-range-track{height:4px;border-radius:2px;background:var(--prism-track,var(--dsw-alias-border-l3))}
.prism-range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;border:.5px solid var(--dsw-alias-border-l4);border-radius:50%;background:var(--dsw-alias-button-elevated-fill);box-shadow:0 1px 3px #00000038}
.prism-range::-moz-range-thumb{width:14px;height:14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:50%;background:var(--dsw-alias-button-elevated-fill);box-shadow:0 1px 3px #00000038}
.prism-wall-swatch{width:44px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);cursor:pointer;box-shadow:inset 0 0 0 .5px #0000002e}
.prism-wall-swatch[aria-pressed=true]{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-label-primary)}
.prism-wall-swatch:focus-visible,.prism-drop:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.prism-drop{padding:18px 12px;border:1px dashed var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;text-align:center;cursor:pointer}
.prism-drop:hover,.prism-drop[data-active]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.prism-wall-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;min-height:30px}
.prism-input{box-sizing:border-box;flex:1 1 200px;min-width:0;width:100%;padding:6px 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.prism-urls{resize:vertical;font-family:var(--ds-font-family-code);font-size:12px}
.prism-select{height:30px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.prism-check{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}
.prism-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prism-glass{margin-top:2px}
.prism-range:disabled{opacity:.45;cursor:default}
.prism-label{min-width:44px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.prism-stepper{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:13px}
.prism-stepper .prism-btn{width:26px;height:26px;padding:0;border:.5px solid var(--dsw-alias-border-l4)}
.prism-stepper .prism-value{min-width:38px;text-align:center}
.prism-code-sample{margin:0;padding:10px 12px;overflow:auto;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block);color:var(--shiki-foreground,var(--dsw-alias-label-primary));font:12px/19px var(--ds-font-family-code)}
.prism-audit{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.prism-audit svg{flex:none;color:var(--dsw-alias-state-success-primary)}
.prism-audit[data-bad] svg{color:var(--dsw-alias-state-warn-primary)}
.prism-panel{position:fixed;z-index:90;display:flex;flex-direction:column;gap:10px;box-sizing:border-box;width:292px;max-width:calc(100vw - 24px);padding:10px;border-radius:var(--dsw-radius-md);background:var(--dsw-specific-menu);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.prism-panel-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
.prism-panel-actions .prism-btn{width:100%;padding:0 4px}
.prism-dots{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;justify-items:center;padding:2px 0}
.prism-dot{position:relative;width:32px;height:32px;padding:0;border:0;border-radius:50%;cursor:pointer;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l4);transition:transform .12s var(--ds-ease-in-out)}
.prism-dot:hover{transform:scale(1.08)}
.prism-dot[aria-pressed=true]{box-shadow:0 0 0 2px var(--dsw-specific-menu),0 0 0 3.5px var(--dsw-alias-state-business-primary)}
.prism-panel-name{min-height:20px;padding:0 2px;color:var(--dsw-alias-label-secondary);text-align:center}
.prism-panel-foot{padding:6px 2px 0;border-top:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:default;user-select:none}
`
