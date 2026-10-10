/* Parametric side-view figure engine for stretch demos.
   Angles are degrees, screen convention: 0 = right, 90 = down, 180 = left, 270 = up.
   Each stretch defines pose A and pose B; the figure eases between them on a loop. */

const SEG = { spine:46, neck:12, uarm:24, farm:23, thigh:31, shin:29, foot:13, head:9 };

function pt(x,y,ang,len){ const r=ang*Math.PI/180; return [x+Math.cos(r)*len, y+Math.sin(r)*len]; }

/* Build every joint coordinate from a pose's angles. */
function solve(p){
  const [hx,hy] = p.hip;
  const [sx,sy] = pt(hx,hy,p.spine,SEG.spine);                 // shoulder
  const [nx,ny] = pt(sx,sy,p.neck ?? p.spine,SEG.neck);        // head centre
  /* Front view: the body has width, so the two sides start from different
     points. Without this a frontal-plane movement (a lateral raise) is drawn
     as though both arms come out of one shoulder, which reads as a side view
     of a front raise — a genuinely misleading picture. */
  const halfW = p.front ? (p.bodyWidth != null ? p.bodyWidth : 13) : 0;
  const sNear = [sx + halfW, sy], sFar = [sx - halfW, sy];
  const hNear = [hx + halfW * 0.8, hy], hFar = [hx - halfW * 0.8, hy];
  const far = {
    elbow: pt(sFar[0],sFar[1],p.armUF ?? p.armU,SEG.uarm),
    knee:  pt(hFar[0],hFar[1],p.thighF ?? p.thigh,SEG.thigh)
  };
  far.hand  = pt(far.elbow[0],far.elbow[1],p.armFF ?? p.armF,SEG.farm);
  far.ankle = pt(far.knee[0], far.knee[1], p.shinF ?? p.shin, SEG.shin);
  far.toe   = pt(far.ankle[0],far.ankle[1],p.footF ?? p.foot, SEG.foot);
  const near = {
    elbow: pt(sNear[0],sNear[1],p.armU,SEG.uarm),
    knee:  pt(hNear[0],hNear[1],p.thigh,SEG.thigh)
  };
  near.hand  = pt(near.elbow[0],near.elbow[1],p.armF,SEG.farm);
  near.ankle = pt(near.knee[0], near.knee[1], p.shin, SEG.shin);
  near.toe   = pt(near.ankle[0],near.ankle[1],p.foot, SEG.foot);
  return { hip:[hx,hy], shoulder:[sx,sy], head:[nx,ny], near, far, bend:p.bend||0,
           prop:p.prop||null, bench:p.bench||null, anchor:p.anchor||null,
           front:!!p.front, sNear, sFar, hNear, hFar };
}

/* --- auto-fit: ground the figure on the floor and centre it in the frame ---
   The transform is computed once per stretch from both key poses, so the two
   poses share one frame and the motion between them stays honest.            */
function joints(S){
  return [S.hip,S.shoulder,S.head,S.sNear,S.sFar,S.hNear,S.hFar,
    S.near.elbow,S.near.hand,S.near.knee,S.near.ankle,S.near.toe,
    S.far.elbow,S.far.hand,S.far.knee,S.far.ankle,S.far.toe];
}
function contactPts(S,spec){
  if(!spec) return joints(S);
  const pts=spec.map(k=>{
    const [s,j]=k.split('.');
    if(s==='hip') return S.hip;
    return (S[s]&&S[s][j])||null;
  }).filter(Boolean);
  return pts.length?pts:joints(S);
}
function makeFit(stretch, view){
  const A=solve(stretch.a), B=solve(stretch.b);
  const extra=S=>[...(S.bench||[]),...(S.anchor?[S.anchor]:[])];
  const all=[...joints(A),...joints(B),...extra(A),...extra(B)];
  const pad=SEG.head+4;
  const xs=all.map(p=>p[0]), ys=all.map(p=>p[1]);
  const minX=Math.min(...xs)-pad, maxX=Math.max(...xs)+pad;
  const minY=Math.min(...ys)-pad, maxY=Math.max(...ys)+pad;
  const bw=maxX-minX, bh=maxY-minY;
  const s=Math.min(view.maxScale||1.15, (view.w)/bw, (view.h)/bh);
  const groundY=Math.max(...contactPts(A,stretch.ground).map(p=>p[1]));
  return { s, tx: view.cx - s*(minX+maxX)/2, ty: view.floor - s*groundY };
}
function applyFit(S,f){
  const T=p=>[p[0]*f.s+f.tx, p[1]*f.s+f.ty];
  return { hip:T(S.hip), shoulder:T(S.shoulder), head:T(S.head), bend:S.bend*f.s, scale:f.s,
    prop:S.prop, bench:S.bench?S.bench.map(T):null, anchor:S.anchor?T(S.anchor):null,
    near:{elbow:T(S.near.elbow),hand:T(S.near.hand),knee:T(S.near.knee),ankle:T(S.near.ankle),toe:T(S.near.toe)},
    far:{elbow:T(S.far.elbow),hand:T(S.far.hand),knee:T(S.far.knee),ankle:T(S.far.ankle),toe:T(S.far.toe)} };
}

const lerp=(a,b,t)=>a+(b-a)*t;
function blend(A,B,t){
  const o={};
  for(const k of Object.keys(A)){
    if(k==='hip') o.hip=[lerp(A.hip[0],B.hip[0],t), lerp(A.hip[1],B.hip[1],t)];
    else if(typeof A[k]==='number' && typeof B[k]==='number') o[k]=lerp(A[k],B[k],t);
    else o[k]=A[k];
  }
  for(const k of Object.keys(B)) if(!(k in o)) o[k]=B[k];
  return o;
}

/* Render a solved skeleton into an existing <svg>. */
function draw(svg, S, opts={}){
  const NS='http://www.w3.org/2000/svg';
  const near=opts.near||'#F5B301', farC=opts.far||'#4A5566', body=opts.body||'#EAEEF4';
  const lw=opts.lw||7;
  while(svg.lastChild) svg.removeChild(svg.lastChild);
  const line=(a,b,col,w)=>{
    const el=document.createElementNS(NS,'line');
    el.setAttribute('x1',a[0].toFixed(1)); el.setAttribute('y1',a[1].toFixed(1));
    el.setAttribute('x2',b[0].toFixed(1)); el.setAttribute('y2',b[1].toFixed(1));
    el.setAttribute('stroke',col); el.setAttribute('stroke-width',w||lw);
    el.setAttribute('stroke-linecap','round'); svg.appendChild(el);
  };
  // far limbs first (depth)
  const oS = S.front ? S.sFar : S.shoulder, oH = S.front ? S.hFar : S.hip;
  line(oS,S.far.elbow,farC,lw-1); line(S.far.elbow,S.far.hand,farC,lw-1);
  line(oH,S.far.knee,farC,lw-1); line(S.far.knee,S.far.ankle,farC,lw-1); line(S.far.ankle,S.far.toe,farC,lw-2);
  // torso as a curve so spinal shape reads (cat/cow, cobra, child's pose)
  const [hx,hy]=S.hip,[sx,sy]=S.shoulder;
  const mx=(hx+sx)/2, my=(hy+sy)/2;
  const dx=sx-hx, dy=sy-hy, L=Math.hypot(dx,dy)||1;
  const bend=S.bend||0;
  const cx2=mx + (-dy/L)*bend, cy2=my + (dx/L)*bend;
  const path=document.createElementNS(NS,'path');
  path.setAttribute('d',`M${hx.toFixed(1)} ${hy.toFixed(1)} Q${cx2.toFixed(1)} ${cy2.toFixed(1)} ${sx.toFixed(1)} ${sy.toFixed(1)}`);
  path.setAttribute('fill','none'); path.setAttribute('stroke',body);
  path.setAttribute('stroke-width',lw+2); path.setAttribute('stroke-linecap','round');
  svg.appendChild(path);
  const h=document.createElementNS(NS,'circle');
  h.setAttribute('cx',S.head[0].toFixed(1)); h.setAttribute('cy',S.head[1].toFixed(1));
  h.setAttribute('r',(SEG.head*(S.scale||1)).toFixed(1)); h.setAttribute('fill',body); svg.appendChild(h);
  // shoulder girdle and pelvis read as width in a front view
  if (S.front) { line(S.sFar,S.sNear,body,lw); line(S.hFar,S.hNear,body,lw); }
  // near limbs
  const nS = S.front ? S.sNear : S.shoulder, nH = S.front ? S.hNear : S.hip;
  line(nS,S.near.elbow,near,lw); line(S.near.elbow,S.near.hand,near,lw);
  line(nH,S.near.knee,near,lw); line(S.near.knee,S.near.ankle,near,lw); line(S.near.ankle,S.near.toe,near,lw-2);

  // equipment, drawn last so it sits in the hands
  const sc=S.scale||1, kit=opts.kit||body;
  const circle=(p,r,fill,stroke)=>{
    const c=document.createElementNS(NS,'circle');
    c.setAttribute('cx',p[0].toFixed(1)); c.setAttribute('cy',p[1].toFixed(1));
    c.setAttribute('r',r.toFixed(1));
    c.setAttribute('fill',fill||'none'); if(stroke){c.setAttribute('stroke',stroke);c.setAttribute('stroke-width',2*sc);}
    svg.appendChild(c);
  };
  if(S.bench) line(S.bench[0],S.bench[1],farC,lw+3);   // bench or box under the body
  if(S.anchor){           // cable or band running to a fixed point
    const l=document.createElementNS(NS,'line');
    l.setAttribute('x1',S.anchor[0].toFixed(1)); l.setAttribute('y1',S.anchor[1].toFixed(1));
    l.setAttribute('x2',S.near.hand[0].toFixed(1)); l.setAttribute('y2',S.near.hand[1].toFixed(1));
    l.setAttribute('stroke',farC); l.setAttribute('stroke-width',(2*sc).toFixed(1));
    l.setAttribute('stroke-dasharray',(4*sc).toFixed(1)+' '+(3*sc).toFixed(1));
    svg.appendChild(l);
    circle(S.anchor,3*sc,farC);
  }
  if(S.prop==='bar'){     // barbell seen end-on: a plate at the hand
    circle(S.near.hand,9*sc,kit); circle(S.near.hand,4.5*sc,'#0A0B0A');
  } else if(S.prop==='barback'){   // bar racked on the traps
    circle(S.shoulder,9*sc,kit); circle(S.shoulder,4.5*sc,'#0A0B0A');
  } else if(S.prop==='db'){
    circle(S.near.hand,5.5*sc,kit); circle(S.far.hand,4.5*sc,farC);
  } else if(S.prop==='db2'){
    circle(S.near.hand,5.5*sc,kit); circle(S.far.hand,5.5*sc,kit);
  }
}

/* Animate one stretch into one <svg>. Returns a stop() handle. */
/* ---- one ticker drives every figure on screen ----
   Ten animated thumbnails on a training day would otherwise be ten rAF loops.
   Figures off screen or on a hidden tab are skipped entirely.              */
const TICKER={items:new Set(), raf:null, fps:30, last:0, io:null};

function ensureIO(){
  if(TICKER.io || typeof IntersectionObserver==='undefined') return;
  TICKER.io=new IntersectionObserver(es=>{
    es.forEach(e=>{ const it=e.target.__fig; if(it) it.onScreen=e.isIntersecting; });
  },{rootMargin:'80px'});
}
function tick(ts){
  TICKER.raf=requestAnimationFrame(tick);
  if(ts-TICKER.last < 1000/TICKER.fps) return;
  TICKER.last=ts;
  if(document.hidden) return;
  TICKER.items.forEach(it=>{
    if(it.paused || it.onScreen===false) return;
    const period=it.stretch.ms||2600;
    const u=((ts-it.t0)%period)/period;
    const tri=u<0.5?u*2:(1-u)*2;                        // out and back
    const e=tri<0.5?2*tri*tri:1-Math.pow(-2*tri+2,2)/2; // ease in/out
    draw(it.svg, applyFit(solve(blend(it.stretch.a,it.stretch.b,e)),it.fit), it.opts);
  });
}
function animate(svg, stretch, opts={}){
  const view=opts.view||{w:150,h:104,cx:100,floor:112,maxScale:1.15};
  const fit=makeFit(stretch,view);
  const it={svg,stretch,fit,opts,t0:performance.now(),paused:!!opts.still,onScreen:undefined};
  draw(svg, applyFit(solve(stretch.a),fit), opts);   // static first frame
  TICKER.items.add(it);
  svg.__fig=it; ensureIO(); if(TICKER.io) TICKER.io.observe(svg);
  if(!TICKER.raf) TICKER.raf=requestAnimationFrame(tick);
  return ()=>{
    TICKER.items.delete(it);
    if(TICKER.io){ try{TICKER.io.unobserve(svg)}catch(e){} }
    if(!TICKER.items.size && TICKER.raf){ cancelAnimationFrame(TICKER.raf); TICKER.raf=null; }
  };
}

if(typeof module!=='undefined') module.exports={SEG,solve,blend,draw,animate,makeFit,applyFit,joints};
