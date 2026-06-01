'use client';

// Kaya Tycoon — scoped stylesheet. The prototype's CSS ported 1:1 (layout,
// sizing, animations preserved exactly) but recoloured to the Kaya Games
// palette (games-*). Everything is scoped under `.kt-root` and prefixed `kt-`
// so it can't leak into the rest of the app. Functional property colour-sets
// are passed inline by the components; this file is chrome + motion only.

const CSS = `
.kt-root{
  --kt-bg:#1A1240; --kt-bg2:#2A1A63; --kt-panel:#ffffff; --kt-ink:#1A1240;
  --kt-pink:#FF8FB1; --kt-purple:#6B3FE0; --kt-purple-deep:#4A1FB8; --kt-teal:#2DD4BF;
  --kt-gold:#FFC93C; --kt-green:#2ecc71; --kt-orange:#ff8c42; --kt-sky:#7DD3FC; --kt-coral:#FF6B6B;
  --kt-shadow:0 8px 24px rgba(0,0,0,.18);
  font-family:var(--font-body,system-ui,sans-serif); color:var(--kt-ink);
}
.kt-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
.kt-root h1,.kt-root h2,.kt-root h3{margin:0;font-family:var(--font-display,system-ui,sans-serif);}
.kt-root button{font-family:inherit;cursor:pointer;border:none;border-radius:14px;font-weight:800;
  padding:10px 16px;font-size:15px;transition:transform .08s ease,filter .15s ease;}
.kt-root button:active{transform:scale(.94);}
.kt-root button:hover:not(:disabled){filter:brightness(1.07);}
.kt-root button:disabled{opacity:.4;cursor:not-allowed;}
.kt-btn-primary{background:var(--kt-purple);color:#fff;box-shadow:var(--kt-shadow);}
.kt-btn-go{background:var(--kt-green);color:#fff;box-shadow:var(--kt-shadow);font-size:18px;padding:14px 22px;}
.kt-btn-buy{background:var(--kt-teal);color:#04312c;}
.kt-btn-warn{background:var(--kt-orange);color:#fff;}
.kt-btn-ghost{background:#efeaff;color:var(--kt-purple-deep);}
.kt-btn-end{background:var(--kt-pink);color:#3a0d22;}

/* TOP BAR */
.kt-topbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:8px 14px;background:rgba(26,18,64,.85);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}
.kt-topbar a{color:#fff;text-decoration:none;font-weight:800;font-size:14px;opacity:.92;}
.kt-topbar a:hover{opacity:1;}
.kt-topbar .kt-tb-title{margin-left:auto;font-weight:900;opacity:.85;font-size:14px;color:#fff;}

/* SETUP */
.kt-setup{max-width:800px;margin:0 auto;padding:18px 16px 60px;text-align:center;color:#fff;}
.kt-logo{font-size:clamp(34px,8vw,54px);font-weight:900;letter-spacing:1px;line-height:1;
  background:linear-gradient(90deg,var(--kt-gold),var(--kt-pink),var(--kt-teal));
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  filter:drop-shadow(0 4px 10px rgba(0,0,0,.3));}
.kt-tag{opacity:.85;margin:6px 0 18px;font-size:15px;}
.kt-card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:22px;padding:18px;margin:12px 0;text-align:left;}
.kt-card h3{color:var(--kt-gold);margin-bottom:10px;font-size:18px;}
.kt-mode-row{display:flex;gap:12px;flex-wrap:wrap;}
.kt-mode{flex:1;min-width:200px;background:rgba(255,255,255,.06);border:3px solid transparent;border-radius:18px;padding:14px;cursor:pointer;transition:.15s;}
.kt-mode:hover{background:rgba(255,255,255,.12);}
.kt-mode.sel{border-color:var(--kt-gold);background:rgba(255,201,60,.15);}
.kt-mode b{font-size:16px;color:#fff;}
.kt-mode small{display:block;margin-top:6px;opacity:.85;line-height:1.4;color:#fff;}
.kt-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;}
.kt-chip{background:rgba(255,255,255,.08);border:2px solid transparent;border-radius:14px;padding:9px 13px;cursor:pointer;font-weight:700;color:#fff;transition:.12s;font-size:14px;}
.kt-chip:hover{background:rgba(255,255,255,.16);}
.kt-chip.sel{border-color:var(--kt-gold);background:rgba(255,201,60,.18);}
.kt-chip small{display:block;font-weight:400;opacity:.75;font-size:11px;}
.kt-pl-row{display:flex;align-items:center;gap:10px;margin:8px 0;flex-wrap:wrap;}
.kt-pl-row input{flex:1;min-width:120px;padding:10px 12px;border-radius:12px;border:none;font-size:15px;color:var(--kt-ink);}
.kt-token-pick{display:flex;gap:6px;flex-wrap:wrap;}
.kt-tok{font-size:22px;width:42px;height:42px;border-radius:12px;border:2px solid transparent;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;cursor:pointer;}
.kt-tok.sel{border-color:var(--kt-gold);background:rgba(255,201,60,.25);}
.kt-small-note{font-size:13px;opacity:.78;margin-top:8px;color:#fff;}
.kt-toggle-row{display:flex;align-items:center;gap:10px;margin-top:12px;color:#fff;}
.kt-switch{position:relative;width:52px;height:28px;background:rgba(255,255,255,.2);border-radius:20px;cursor:pointer;transition:.2s;flex:0 0 auto;}
.kt-switch.on{background:var(--kt-green);}
.kt-switch::after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;background:#fff;border-radius:50%;transition:.2s;}
.kt-switch.on::after{left:27px;}
.kt-root select,.kt-root input[type=number]{padding:8px;border-radius:10px;border:1px solid #ccc;font-size:14px;font-family:inherit;color:var(--kt-ink);}

/* GAME */
.kt-layout{display:flex;gap:16px;padding:12px;align-items:flex-start;justify-content:center;flex-wrap:wrap;}
.kt-board-wrap{flex:0 0 auto;position:relative;}
.kt-board{display:grid;grid-template-columns:repeat(11,1fr);grid-template-rows:repeat(11,1fr);
  width:min(94vw,820px);height:min(94vw,820px);max-height:84vh;max-width:84vh;
  background:var(--kt-purple-deep);border-radius:18px;padding:7px;gap:3px;box-shadow:var(--kt-shadow);}
.kt-tile{background:var(--kt-panel);border-radius:6px;position:relative;overflow:hidden;display:flex;flex-direction:column;
  font-size:clamp(6px,1.05vmin,11px);line-height:1.05;padding:3px;cursor:pointer;transition:transform .12s ease,box-shadow .12s;}
.kt-tile:hover{transform:scale(1.05);z-index:5;box-shadow:0 0 0 2px var(--kt-gold);}
.kt-tile .kt-cbar{height:clamp(10px,1.7vmin,18px);border-radius:3px 3px 0 0;margin:-3px -3px 2px;}
.kt-tile .kt-nm{font-weight:800;text-transform:uppercase;font-size:clamp(6px,1vmin,10px);flex:1;}
.kt-tile .kt-pr{font-weight:700;color:#666;font-size:clamp(5px,.9vmin,9px);}
.kt-tile.kt-corner{align-items:center;justify-content:center;text-align:center;}
.kt-tile .kt-own{position:absolute;top:2px;right:3px;display:flex;align-items:center;gap:1px;}
.kt-tile .kt-houses{position:absolute;bottom:1px;left:3px;font-size:clamp(7px,1.2vmin,12px);letter-spacing:-1px;}
.kt-tile .kt-toks{position:absolute;bottom:1px;right:2px;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:0;max-width:62%;}
.kt-tile .kt-toks span{font-size:clamp(11px,1.9vmin,17px);}
.kt-tile.kt-hop .kt-toks span{animation:kt-hop .4s;}
@keyframes kt-hop{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px) scale(1.2)}}
.kt-center{grid-column:2 / 11;grid-row:2 / 11;background:linear-gradient(135deg,var(--kt-purple),var(--kt-pink));border-radius:14px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;padding:14px;text-align:center;position:relative;overflow:hidden;}
.kt-center .kt-ttl{font-size:clamp(20px,4.4vmin,42px);font-weight:900;letter-spacing:1px;text-shadow:0 3px 8px rgba(0,0,0,.3);line-height:1;}
.kt-center .kt-sub{opacity:.92;margin-top:4px;font-size:clamp(11px,1.6vmin,15px);}
.kt-mover{font-size:clamp(40px,9vmin,84px);font-weight:900;color:#fff;text-shadow:0 4px 16px rgba(0,0,0,.4);min-height:1.1em;margin-top:6px;}
.kt-mover.kt-pulse{animation:kt-moverpulse .16s;}
@keyframes kt-moverpulse{0%{transform:scale(.5);opacity:.3}100%{transform:scale(1);opacity:1}}
.kt-cflash{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;pointer-events:none;opacity:0;}
.kt-cflash.kt-show{animation:kt-cflash 1.4s ease forwards;}
.kt-cflash .kt-ce{font-size:clamp(30px,7vmin,68px);}
.kt-cflash .kt-ct{font-size:clamp(15px,2.4vmin,24px);font-weight:900;color:#fff;text-shadow:0 3px 10px rgba(0,0,0,.5);margin-top:4px;}
@keyframes kt-cflash{0%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1.1)}30%{transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:scale(1)}}

.kt-panel{flex:1;min-width:290px;max-width:430px;display:flex;flex-direction:column;gap:12px;}
.kt-pbox{background:var(--kt-panel);border-radius:18px;padding:14px;box-shadow:var(--kt-shadow);}
.kt-turn{display:flex;align-items:center;gap:10px;}
.kt-turn .kt-ava{font-size:30px;}
.kt-turn .kt-who{font-size:18px;font-weight:900;}
.kt-turn .kt-cash{margin-left:auto;font-size:18px;font-weight:900;color:var(--kt-green);}
.kt-dice{display:flex;gap:12px;margin:14px 0 4px;align-items:center;justify-content:center;}
.kt-die{width:clamp(38px,6vmin,54px);height:clamp(38px,6vmin,54px);border-radius:12px;background:#fff;color:var(--kt-ink);font-size:clamp(24px,4.4vmin,38px);font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:var(--kt-shadow);border:1px solid #eee;}
.kt-die.kt-roll{animation:kt-shake .5s;}
@keyframes kt-shake{0%,100%{transform:translateY(0) rotate(0)}20%{transform:translateY(-10px) rotate(-15deg)}60%{transform:translateY(-5px) rotate(15deg)}}
.kt-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}
.kt-tip{margin-top:10px;background:#fff7df;border:1px solid #ffe08a;border-radius:12px;padding:8px 10px;font-size:13px;color:#7a5b00;}
.kt-log{height:110px;overflow-y:auto;font-size:13px;line-height:1.5;background:var(--font-games-bg,#F5F0FF);border-radius:12px;padding:10px;}
.kt-log div{margin-bottom:3px;}
.kt-players-list{display:flex;flex-direction:column;gap:8px;}
.kt-pcard{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;background:#F5F0FF;font-size:14px;cursor:pointer;transition:.12s;}
.kt-pcard:hover{background:#ece6ff;transform:translateX(2px);}
.kt-pcard.kt-active{outline:3px solid var(--kt-gold);}
.kt-pcard .kt-pc-cash{margin-left:auto;font-weight:900;}
.kt-pcard.kt-broke{opacity:.45;text-decoration:line-through;}
.kt-props-mini{font-size:11px;opacity:.8;}

/* MODALS */
.kt-overlay{position:fixed;inset:0;background:rgba(20,10,50,.7);display:flex;align-items:center;justify-content:center;z-index:80;padding:16px;}
.kt-modal{background:#fff;border-radius:22px;max-width:460px;width:100%;max-height:90vh;overflow-y:auto;padding:22px;box-shadow:var(--kt-shadow);text-align:center;animation:kt-pop .25s;}
@keyframes kt-pop{from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}
.kt-modal h2{font-size:22px;margin-bottom:6px;}
.kt-modal .kt-cbar2{height:18px;border-radius:8px;margin:0 0 14px;}
.kt-modal p{font-size:15px;line-height:1.5;margin:8px 0;}
.kt-modal .kt-row{display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap;}
.kt-card-emoji{font-size:48px;margin:6px 0;}
.kt-rent-table{font-size:13px;text-align:left;background:#F5F0FF;border-radius:12px;padding:10px 14px;margin:10px 0;}
.kt-rent-table div{display:flex;justify-content:space-between;padding:1px 0;gap:10px;}
.kt-build-list{text-align:left;max-height:46vh;overflow-y:auto;margin:10px 0;}
.kt-build-item{display:flex;align-items:center;gap:8px;padding:8px;border-radius:10px;background:#F5F0FF;margin-bottom:6px;flex-wrap:wrap;}
.kt-build-item .kt-bi-name{flex:1;font-weight:700;font-size:14px;min-width:110px;}
.kt-win-emoji{font-size:64px;}
.kt-invest-tip{background:#eafff1;border:1px solid #a7e9c1;border-radius:12px;padding:10px;font-size:13px;text-align:left;color:#1c6b3e;margin:6px 0;}
.kt-holding{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:10px;background:#F5F0FF;margin-bottom:5px;font-size:13px;text-align:left;}
.kt-fx{position:fixed;inset:0;pointer-events:none;z-index:90;}
@media(max-width:760px){.kt-layout{flex-direction:column;align-items:center;padding:8px;}.kt-panel{max-width:820px;width:100%;}}
`;

export default function TycoonStyles() {
  // eslint-disable-next-line react/no-danger
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
