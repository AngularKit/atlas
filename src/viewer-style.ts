export const viewerStyle = `
:root{font-family:"Avenir Next","Segoe UI",sans-serif;color:#172c48;background:#f7faff;font-synthesis:none;color-scheme:light;--blue:#174f9d;--line:#b7cee9;--muted:#516882}

*{box-sizing:border-box}
body{margin:0;height:100dvh;display:flex;flex-direction:column;overflow:hidden}
button,input{font:inherit}
button{cursor:pointer;color:inherit}
button:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:3px solid #3277d4;outline-offset:3px}
button{background:white;border:1px solid #c4d3e6;border-radius:7px;padding:9px 13px}
button:hover{background:#edf4ff}
button:disabled{opacity:.5;cursor:default}
header{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:22px 30px;border-bottom:1px solid #d6e2ef;background:white}
.brand{display:flex;align-items:baseline;gap:18px}
.brand strong{font-size:26px;letter-spacing:-1px;color:var(--blue)}
h1{font-size:18px;font-weight:500;margin:0}
.status{display:flex;align-items:center;gap:14px;font-size:14px}
.warning{color:#794d09;background:#fff4d9;border-color:#dac28c}
.toolbar{flex-shrink:0;display:flex;align-items:center;gap:10px;padding:16px 30px;background:white;border-bottom:1px solid #d6e2ef}
.search{flex:1;max-width:580px}
.search label{display:block;font-size:12px;color:var(--muted);margin-bottom:5px}
.search input{width:100%;border:1px solid #b7c9df;border-radius:7px;padding:11px 14px;background:#f7faff;color:inherit}
.toolbar-actions{display:flex;gap:8px;align-items:center;margin-left:auto}
.zoom-value{min-width:45px;text-align:center;font-size:13px;color:var(--muted)}
.workspace{display:grid;grid-template-columns:minmax(0,1fr) 350px;flex:1;min-height:0}
.map-panel{min-width:0;min-height:0;display:flex;flex-direction:column}
.map-summary{padding:15px 30px;display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:13px;border-bottom:1px solid #dbe6f3}
.map-summary p{margin:0}
.viewport{flex:1;min-height:0;overflow:auto;position:relative;overscroll-behavior:contain;background-image:radial-gradient(#c8d9ed .8px,transparent .8px);background-size:20px 20px;cursor:grab;touch-action:pan-x pan-y}
.viewport.dragging{cursor:grabbing;user-select:none}
.sizer{position:relative;min-width:100%;min-height:100%}
.stage{position:absolute;left:0;top:0;transform-origin:top left}
.edges{position:absolute;inset:0;pointer-events:none;overflow:visible}
.edge{fill:none;stroke:#9bb9de;stroke-width:1.5}
.node{position:absolute;width:230px;height:80px;display:flex;border:1px solid #a8c1e1;border-radius:10px;background:#fff;box-shadow:0 3px 7px #224d7810;overflow:hidden}
.node.selected{border:2px solid #174f9d;background:#eef5ff;box-shadow:0 0 0 3px #174f9d18}
.node.entry{border-style:dashed;background:#eaf2fc}
.node.problem{border-left:4px solid #b77c21}
.node-main{border:0;border-radius:0;padding:12px 14px;flex:1;min-width:0;text-align:left;background:transparent}
.node-main:hover{background:#edf4ff}
.node-path{display:block;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:14px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.node-meta{display:block;font-size:12px;color:var(--muted);margin-top:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.toggle{border:0;border-left:1px solid #d4e1f2;border-radius:0;background:#f0f6ff;width:43px;padding:4px;flex-shrink:0;font-size:13px}
.toggle span{display:block;font-size:20px;line-height:1.2}
.toggle small{font-size:11px}
.inspector{background:white;border-left:1px solid #d6e2ef;padding:26px 24px;overflow:auto;height:100%;min-height:0;scroll-margin-top:12px}
.inspector h2{font-size:21px;line-height:1.35;margin:0 0 12px;overflow-wrap:anywhere}
.inspector h3{font-size:14px;margin:27px 0 10px;color:#29496d}
.inspector p{font-size:14px;line-height:1.6;color:var(--muted)}
.inspector .eyebrow{font-size:12px;margin:0 0 10px;color:var(--muted)}
.inspector code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
.inspector dl{margin:0}
.inspector dt{font-size:12px;color:var(--muted);margin-top:13px}
.inspector dd{font-size:14px;margin:4px 0 0;overflow-wrap:anywhere}
.inspector .reference{border-left:2px solid #d6e4f6;padding-left:12px;margin:12px 0}
.inspector .reference p{margin:3px 0;font-size:12px}
.inspector ul{padding-left:20px;line-height:1.6;font-size:13px;color:var(--muted)}
.crumbs{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:20px}
.crumbs button{font-size:12px;padding:5px 8px;max-width:100%;overflow-wrap:anywhere}
.notice{background:#fff5df;border-left:3px solid #b77c21;padding:12px;margin:15px 0}
.notice p{margin:0}
.notice button{margin-top:10px}
.results{flex-shrink:0;background:white;border-bottom:1px solid #d6e2ef;padding:14px 30px;max-height:230px;overflow:auto}
.results[hidden]{display:none}
.results p{font-size:13px;margin:0 0 10px;color:var(--muted)}
.results ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:7px}
.results button{font-size:13px;text-align:left;max-width:100%;overflow-wrap:anywhere}
.results small{display:block;color:var(--muted);margin-top:3px}
.empty{padding:40px;color:var(--muted);max-width:500px;line-height:1.7}
.legend{display:flex;flex-wrap:wrap;gap:20px;padding:13px 30px;font-size:12px;color:var(--muted);background:#fff;border-top:1px solid #d6e2ef}
.legend span:before{content:"";display:inline-block;vertical-align:middle;width:16px;border-top:2px solid #9bb9de;margin-right:7px}
.legend span:last-child:before{width:8px;height:8px;border:0;background:#b77c21;border-radius:2px}
.close-details{display:none}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}

@media(max-width:800px){body{height:auto;display:block;overflow:auto}
header{padding:16px;align-items:flex-start}
.brand{display:block}
.brand strong{font-size:24px}
h1{font-size:14px;margin-top:3px}
.status{flex-direction:column;gap:6px;align-items:flex-end;font-size:12px}
.status button{font-size:12px;padding:7px}
.toolbar{padding:12px 16px;flex-wrap:wrap}
.search{max-width:none;flex-basis:100%}
.toolbar-actions{margin-left:0;width:100%}
.toolbar-actions button:first-child{margin-right:auto}
.workspace{display:block;min-height:0}
.map-summary{padding:12px 16px;font-size:12px}
.map-summary .hint{display:none}
.viewport{flex:none;height:52dvh;min-height:340px}
.inspector{height:auto;border-left:0;border-top:1px solid #d6e2ef;max-height:none;padding:22px 18px}
.legend{padding:12px 16px}
.results{padding:12px 16px}
.close-details{display:block;float:right;margin-left:10px;font-size:12px}
.inspector h2{font-size:20px}
}

@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}
}

`;
