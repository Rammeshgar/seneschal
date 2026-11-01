/* Citylight: the original Seneschal copper-moon skyline, carefully restored.
   Code-authored pixel art. The workspace host owns every clock, animation frame,
   listener and setting. This renderer has no network, audio or storage access. */
(function (root) {
  'use strict';
  const W = 480, H = 270;
  const palettes = {
    nocturne: { sky: '#0c1212', lower: '#23332a', haze: '#65776a', far: '#293a31', mid: '#1e2c25', face: '#27382e', side: '#16231d', ink: '#101b17', edge: '#465b4c', stone: '#627363', green: '#91ac92', warm: '#bb965d', hot: '#dfc69b', red: '#ad7250', moon: '#a1714c', moonLight: '#bc8c5e', road: '#18231d' },
    ember: { sky: '#201815', lower: '#4d3e2b', haze: '#9a8970', far: '#514a36', mid: '#38382a', face: '#484330', side: '#292e24', ink: '#1d251e', edge: '#71674a', stone: '#9a8a65', green: '#b6be8b', warm: '#d6ac70', hot: '#f1d39d', red: '#bf8057', moon: '#bd8350', moonLight: '#dbad6f', road: '#2d3023' },
    sakura: { sky: '#211d23', lower: '#42463c', haze: '#939081', far: '#454b40', mid: '#333a32', face: '#444a3b', side: '#282f29', ink: '#1b2520', edge: '#6f7461', stone: '#9c9e86', green: '#b4c6a7', warm: '#c6a283', hot: '#e9d1b0', red: '#b68278', moon: '#b38b78', moonLight: '#d2ad8f', road: '#2c332b' }
  };
  const finite = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function normalize(p) {
    p = p && typeof p === 'object' ? p : {};
    return {
      palette: Object.prototype.hasOwnProperty.call(palettes, p.palette) ? p.palette : 'nocturne',
      weather: ['clear', 'rain', 'snow', 'mist'].includes(p.weather) ? p.weather : 'clear',
      intensity: clamp(finite(p.intensity, 65), 0, 100),
      worldActivity: clamp(finite(p.worldActivity, 55), 0, 100),
      worldGlow: clamp(finite(p.worldGlow, 55), 0, 100),
      worldFeature: p.worldFeature !== false
    };
  }
  function rng(seed) {
    return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  }
  function mix(a, b, f) {
    a = parseInt(a.slice(1), 16); b = parseInt(b.slice(1), 16);
    return '#' + [16, 8, 0].map(s => Math.round(clamp(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * f, 0, 255)).toString(16).padStart(2, '0')).join('');
  }
  function emissions(c, p, enabled) {
    const v = enabled ? .22 + p.worldGlow / 100 * 1.03 : .035;
    return { green: mix(c.ink, c.green, v), warm: mix(c.ink, c.warm, v), hot: mix(c.ink, c.hot, v), red: mix(c.ink, c.red, v), level: enabled ? .12 + p.worldGlow * .0088 : 0 };
  }
  function tools(ctx) {
    function pixel(x, y, color, w = 1, h = 1) {
      ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    }
    function line(x, y, xx, yy, color, size = 1) {
      x = Math.round(x); y = Math.round(y); xx = Math.round(xx); yy = Math.round(yy);
      const dx = Math.abs(xx - x), sx = x < xx ? 1 : -1, dy = -Math.abs(yy - y), sy = y < yy ? 1 : -1;
      let error = dx + dy;
      for (let n = 0; n < 1400; n++) {
        pixel(x, y, color, size, size); if (x === xx && y === yy) break;
        const e = error * 2; if (e >= dy) { error += dy; x += sx; } if (e <= dx) { error += dx; y += sy; }
      }
    }
    function poly(points, color) {
      const lo = Math.max(0, Math.ceil(Math.min(...points.map(p => p[1])))), hi = Math.min(H - 1, Math.floor(Math.max(...points.map(p => p[1]))));
      for (let y = lo; y <= hi; y++) {
        const hits = [];
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i], b = points[j];
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) hits.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
        hits.sort((a, b) => a - b);
        for (let i = 0; i + 1 < hits.length; i += 2) {
          const x = Math.ceil(hits[i]), end = Math.floor(hits[i + 1]); if (end >= x) pixel(x, y, color, end - x + 1);
        }
      }
    }
    function ellipse(x, y, rx, ry, color) {
      for (let j = -Math.ceil(ry); j <= ry; j++) {
        const dx = Math.floor(rx * Math.sqrt(Math.max(0, 1 - j * j / (ry * ry)))); pixel(x - dx, y + j, color, dx * 2 + 1);
      }
    }
    function ring(x, y, rx, ry, color) {
      // One-pixel raster ring: no anti-aliasing or blended vector edges.
      for (let j = -Math.ceil(ry); j <= ry; j++) {
        const dx = Math.floor(rx * Math.sqrt(Math.max(0, 1 - j * j / (ry * ry)))); pixel(x - dx, y + j, color); pixel(x + dx, y + j, color);
      }
    }
    function glow(x, y, rx, ry, color, strength) {
      const alpha = ctx.globalAlpha;
      for (const [scale, factor] of [[1, .18], [.62, .30], [.32, .48]]) {
        ctx.globalAlpha = alpha * strength * factor; ellipse(x, y, rx * scale, Math.max(1, ry * scale), color);
      }
      ctx.globalAlpha = alpha;
    }
    return { pixel, line, poly, ellipse, ring, glow };
  }
  function sky(ctx, q, c) {
    const random = rng(61643);
    for (let y = 0; y < H; y++) q.pixel(0, y, mix(c.sky, c.lower, Math.pow(Math.min(1, y / 181), 2)), W);
    for (let i = 0; i < 93; i++) {
      const x = Math.floor(random() * W), y = Math.floor(random() * 119);
      q.pixel(x, y, i % 13 === 0 ? c.stone : mix(c.sky, c.haze, .54));
      if (i % 31 === 0) q.pixel(x + 1, y, mix(c.sky, c.haze, .25));
    }
    // The unusually large copper disc is the original scene's signature.
    const cx = 106, cy = 74, r = 49;
    q.glow(cx, cy, r + 12, r + 8, c.moon, .10);
    for (let y = -r; y <= r; y++) {
      const dx = Math.floor(Math.sqrt(r * r - y * y));
      for (let x = -dx; x <= dx; x++) {
        if ((y + r) % 9 === 0 || ((y + r) % 9 === 1 && y > 9)) continue;
        const centre = Math.max(0, 1 - Math.hypot(x + 5, y + 7) / (r + 13));
        const grain = ((x * 13 + y * 7) & 15) === 0 ? .045 : 0;
        q.pixel(cx + x, cy + y, mix(c.moon, c.moonLight, Math.min(1, centre * .76 + grain)));
      }
    }
    // Long, almost invisible cloud filaments keep the sky spacious.
    ctx.globalAlpha = .15; q.pixel(57, 94, c.haze, 101); q.pixel(33, 96, c.haze, 156);
    ctx.globalAlpha = .09; q.pixel(161, 64, c.haze, 94); q.pixel(8, 111, c.haze, 217); ctx.globalAlpha = 1;
  }
  function building(q, ctx, c, light, random, x, y, w, bottom, layer, variant) {
    const far = layer === 0, face = far ? c.far : layer === 1 ? c.mid : c.face;
    q.pixel(x, y, face, w, bottom - y); q.pixel(x + w - 3, y, far ? c.far : c.side, 3, bottom - y);
    q.pixel(x, y, far ? mix(c.far, c.haze, .21) : c.edge, w - 2);
    if (variant % 4 === 0) { q.pixel(x + 2, y - 3, face, Math.max(3, w - 5), 3); q.pixel(x + 3, y - 4, c.edge, Math.max(2, w - 7)); }
    if (!far && variant % 5 === 0) { q.pixel(x + w / 2, y - 8, c.edge, 1, 7); q.pixel(x + w / 2, y - 9, light.red); }
    const gap = far ? 4 : 4 + variant % 2, row = far ? 5 : 6;
    for (let yy = y + 4; yy < bottom - 3; yy += row) {
      if (!far && variant % 3 === 0) q.pixel(x + 1, yy + 3, c.side, w - 3);
      for (let xx = x + 2; xx < x + w - 4; xx += gap) {
        const a = random();
        if (a > (far ? .76 : .28)) {
          const color = a > .84 ? light.warm : far ? mix(c.far, light.green, .37) : light.green;
          q.pixel(xx, yy, color, far ? 1 : variant % 3 === 1 ? 1 : 2, far ? 1 : 2);
          if (!far && a > .92 && yy < bottom - 9) q.pixel(xx, yy + 2, c.edge, 2);
        }
      }
    }
    if (!far && w > 16) {
      // Roof services, cable runs, fire stairs: details serve a real silhouette.
      q.pixel(x + 3, y - 5, c.side, 7, 5); q.pixel(x + 3, y - 5, c.stone, 7);
      q.pixel(x + 5, y - 7, c.edge, 3, 2);
      if (variant % 3 === 1) {
        q.line(x + w - 5, y + 6, x + w - 5, bottom - 6, c.edge);
        for (let yy = y + 10; yy < bottom - 5; yy += 9) { q.pixel(x + w - 8, yy, c.ink, 7, 2); q.line(x + w - 8, yy, x + w - 3, yy + 7, c.edge); }
      }
      if (variant % 4 === 2) {
        q.pixel(x + 3, y + 8, c.side, 6, 8); q.pixel(x + 4, y + 9, c.edge, 4, 4); q.pixel(x + 5, y + 10, c.stone, 1, 2);
      }
    }
  }
  function skyline(ctx, q, c, light) {
    const random = rng(20261025);
    // Three genuinely different scales, rather than copies with different tint.
    for (let x = -1, i = 0; x < W; i++) {
      const w = 5 + Math.floor(random() * 10), y = 126 + Math.floor(random() * 30);
      building(q, ctx, c, light, random, x, y, w, 173, 0, i); x += w + 1;
    }
    ctx.globalAlpha = .16; q.pixel(0, 159, c.haze, W, 2); q.pixel(0, 166, c.haze, W); ctx.globalAlpha = 1;
    const blocks = [
      [-3,132,18],[18,111,23],[44,124,18],[65,135,16],[83,116,18],[104,135,16],[123,108,23],[149,125,15],[168,101,20],[191,126,17],[211,112,17],[232,133,19],[255,116,20],[279,129,18],[301,103,22],[327,123,18],[412,112,22],[437,129,16],[456,106,25]
    ];
    blocks.forEach(([x,y,w], i) => building(q,ctx,c,light,random,x,y,w,180,1,i));
    // A stepped civic block and small roof gardens form the left skyline rhythm.
    q.pixel(28, 104, c.mid, 8, 7); q.pixel(30, 101, c.edge, 4, 3);
    q.pixel(171, 93, c.mid, 13, 8); q.pixel(174, 90, c.edge, 7, 3);
    q.pixel(129, 103, c.side, 9, 5); q.line(132, 103, 132, 96, c.stone); q.pixel(131, 94, light.red, 2);
    for (const [x,y] of [[83,114],[281,127],[440,127]]) { q.pixel(x,y,c.edge,8); q.pixel(x+1,y-2,c.far,2,2); q.pixel(x+5,y-3,c.far,2,3); }
    // Foreground warehouse roofs stop at the road horizon; the broad view stays.
    for (let x = -4, i = 0; x < W; i++) {
      const w = 15 + Math.floor(random() * 17), y = 145 + Math.floor(random() * 18);
      building(q,ctx,c,light,random,x,y,w,187,2,i+20); x += w+3;
    }
    q.pixel(0, 179, c.ink, W, 11); q.pixel(0, 180, c.edge, W); q.pixel(0, 183, c.side, W, 5);
    // Shop fronts and sheltered arcades, read as tiny inhabited interiors.
    for (let x=4,i=0;x<W;x+=19,i++) {
      const width=12+(i%3), color=i%4===0?light.warm:mix(c.side,light.green,.52);
      q.pixel(x,174,c.side,width,7); q.pixel(x+1,175,color,width-2,4); q.pixel(x+Math.floor(width/2),175,c.side,1,5);
      if (i%3===0) q.pixel(x,172,c.edge,width+1);
      q.pixel(x+2,180,c.ink,width,2);
    }
    // Narrow elevated cross street, guard rails and support piers.
    q.pixel(0,184,c.ink,W,7);q.pixel(0,184,c.stone,W);q.pixel(0,188,c.edge,W);
    for(let x=7;x<W;x+=16)q.pixel(x,181,c.edge,1,4);
    for(const x of [42,140,355,449]){q.pixel(x,190,c.ink,5,12);q.pixel(x,191,c.edge,1,10);}
  }
  function tower(ctx,q,c,light) {
    const x=347,y=56,w=61;
    q.pixel(x-2,y+5,c.ink,w+4,126);q.pixel(x,y,c.side,w,126);
    q.pixel(x-2,y-3,c.edge,w+4,3);q.pixel(x+3,y-5,c.stone,w-6,2);
    q.pixel(x+8,y-9,c.face,45,4);q.pixel(x+13,y-12,c.edge,34,3);
    q.line(x+30,y-13,x+30,y-29,c.stone);q.pixel(x+29,y-31,light.red,3,2);
    q.line(x+30,y-24,x+21,y-17,c.edge);q.line(x+30,y-21,x+39,y-15,c.edge);
    q.pixel(x+3,y+3,c.face,w-6,104);q.pixel(x+6,y+6,c.ink,w-12,43);
    q.pixel(x+8,y+8,mix(c.ink,c.far,.8),w-16,39);
    for(let row=0;row<6;row++) for(let col=0;col<8;col++) {
      q.pixel(x+10+col*5,y+10+row*6,(row+col)%4===0?light.warm:mix(c.face,light.green,.45),2,2);
    }
    q.pixel(x+7,y+48,c.edge,w-14,2);q.pixel(x+13,y+52,c.ink,35,4);q.pixel(x+18,y+53,light.warm,4);q.pixel(x+26,y+53,light.green,14);
    for(let yy=y+61;yy<179;yy+=7){
      q.pixel(x+5,yy+4,c.side,w-10);
      for(let xx=x+8;xx<x+w-9;xx+=6){q.pixel(xx,yy,(xx+yy)%11<4?light.warm:light.green,2,2);q.pixel(xx,yy+2,c.edge,2);}
    }
    q.pixel(x+3,y+5,c.edge,2,118);q.pixel(x+w-6,y+5,c.ink,3,120);
    q.pixel(x-3,138,c.ink,8,39);q.pixel(x-2,141,c.edge,4,30);q.pixel(x+w-1,126,c.ink,7,55);q.pixel(x+w,130,c.face,4,46);
    for(let yy=134;yy<175;yy+=8)q.pixel(x+w+1,yy,light.warm,1,3);
    q.pixel(x+12,179,c.edge,39,3);q.pixel(x+18,182,c.ink,27,6);q.pixel(x+21,183,light.green,21,2);
    q.glow(x+30,103,49,34,c.green,.10*light.level);
  }
  function avenue(ctx,q,c,light) {
    const random=rng(77016),vx=250,top=187;
    q.pixel(0,191,c.ink,W,79);
    q.poly([[vx-13,top],[vx+13,top],[480,270],[16,270]],c.road);
    q.poly([[vx-16,top],[vx-13,top],[20,270],[8,270]],c.side);
    q.poly([[vx+13,top],[vx+17,top],[480,260],[480,270]],c.side);
    // Sober long reflections, broken into facets of asphalt rather than water.
    for(let y=192;y<H;y++) {
      const d=(y-top)/(H-top),half=13+d*223;
      ctx.globalAlpha=.05+d*.07;q.pixel(vx-half,y,c.green,half*2);
      ctx.globalAlpha=.05+d*.10;q.pixel(vx-3-d*11,y,c.warm,4+d*21);
    }
    ctx.globalAlpha=1;
    q.line(vx-13,top,19,269,c.edge);q.line(vx+13,top,479,269,c.warm);
    q.line(vx-21,top,0,257,c.ink,2);q.line(vx+19,top,479,248,c.ink,2);
    // Expansion joints and paving blocks line the viewing platform.
    q.line(0,207,210,193,c.face);q.line(0,232,171,206,c.side);q.line(411,208,480,216,c.face);
    for(let i=0;i<8;i++){q.line(i*21,270,i*12+143,215,c.side);q.line(438+i*14,270,361+i*8,218,c.side);}
    for(let i=0;i<165;i++) {
      const y=193+random()*77,d=(y-top)/83,x=vx+(random()-.5)*(26+d*435);
      ctx.globalAlpha=(.04+random()*.16)*light.level;
      q.pixel(x,y,i%5===0?c.warm:c.green,1+Math.floor(random()*d*17));
      if(i%9===0)q.pixel(x+2,y+2,c.ink,1+Math.floor(d*8));
    }
    ctx.globalAlpha=1;
    // Lane guides share the original strong single vanishing point.
    q.line(245,190,150,270,mix(c.road,c.green,.35));q.line(256,190,355,270,mix(c.road,c.warm,.28));
    for(const [y,h] of [[192,1],[198,2],[207,3],[221,5],[243,8]]){
      const d=(y-187)/83;q.poly([[250-d*2,y],[251+d*2,y],[252+d*3,y+h],[249-d*3,y+h]],light.hot);
    }
    // Drain grates, repaired tarmac and faint tire grooves keep it a road.
    q.poly([[75,249],[100,239],[112,242],[86,253]],c.ink);for(let i=0;i<5;i++)q.line(80+i*5,249-i*2,85+i*5,250-i*2,c.edge);
    q.poly([[316,231],[335,229],[355,238],[333,241]],mix(c.road,c.ink,.5));
    q.line(222,210,118,267,c.side);q.line(279,210,386,267,c.side);
    for(const side of [-1,1]) for(let i=0;i<5;i++) {
      const d=(i+1)/5,y=191+d*d*68,x=vx+side*(17+d*d*218),height=4+d*18;
      q.pixel(x,y-height,c.ink,1,Math.ceil(height));q.pixel(x+side,y-height,c.edge,1,Math.ceil(height));
      q.line(x,y-height,x-side*(2+d*4),y-height,c.stone);
      q.pixel(x-side*(3+d*4),y-height,side<0?light.green:light.warm,2+d*2);
      q.glow(x-side*4,y-height,5+d*6,3+d*4,side<0?c.green:c.warm,.18*light.level);
      ctx.globalAlpha=.16*light.level;q.pixel(x-side*2,y+3,side<0?c.green:c.warm,2,3+d*5);ctx.globalAlpha=1;
    }
    // Foreground railing, two roof plants and a silent late-night platform.
    q.poly([[0,242],[18,245],[18,270],[0,270]],c.ink);q.pixel(0,241,c.edge,19,2);q.pixel(4,232,c.side,11,10);
    q.pixel(4,231,c.stone,11);q.pixel(8,226,c.far,5,6);q.pixel(5,227,c.far,4,2);q.pixel(11,224,c.edge,3,4);
    q.pixel(469,243,c.ink,11,27);q.pixel(469,242,c.edge,11,2);q.pixel(474,232,c.side,6,10);q.pixel(473,231,c.stone,7);
    q.line(4,266,58,252,c.ink,2);q.line(4,261,58,247,c.edge);q.line(41,256,41,251,c.edge);q.line(19,263,19,257,c.edge);
    q.line(447,252,479,261,c.ink,2);q.line(447,247,479,256,c.edge);q.line(455,255,455,249,c.edge);
  }
  function cachedArt(ctx,c,p,enabled) {
    const q=tools(ctx),light=emissions(c,p,enabled);
    sky(ctx,q,c);skyline(ctx,q,c,light);tower(ctx,q,c,light);avenue(ctx,q,c,light);
  }
  function smallCar(q,ctx,c,light,x,y,s,direction) {
    q.ellipse(x+6*s,y+5*s,10*s,2*s,c.ink);
    q.pixel(x,y,c.side,14*s,4*s);q.poly([[x+3*s,y],[x+5*s,y-3*s],[x+10*s,y-3*s],[x+13*s,y]],c.edge);
    q.pixel(x+5*s,y-2*s,c.ink,5*s,2*s);q.pixel(x+6*s,y-2*s,light.green,2*s);
    q.pixel(x-1*s,y+2*s,c.face,16*s,2*s);q.pixel(x+2*s,y+4*s,c.ink,3*s,2*s);q.pixel(x+11*s,y+4*s,c.ink,3*s,2*s);
    q.pixel(x+(direction>0?14:0)*s,y+2*s,light.hot,2*s);q.pixel(x+(direction>0?0:14)*s,y+2*s,light.red,1*s);
    ctx.globalAlpha=.22*light.level;q.pixel(x+3*s,y+7*s,c.warm,10*s,Math.max(1,s));ctx.globalAlpha=1;
  }
  function roadCar(q,ctx,c,light,progress,lane) {
    const d=progress*progress,y=190+d*85,s=.4+d*1.55,x=250+lane*(4+d*79)-7*s;
    q.ellipse(x+7*s,y+6*s,10*s,2*s,c.ink);
    q.poly([[x+2*s,y-3*s],[x+11*s,y-3*s],[x+15*s,y+3*s],[x-1*s,y+3*s]],c.face);
    q.pixel(x+3*s,y-2*s,c.side,7*s,3*s);q.pixel(x+4*s,y-2*s,c.edge,6*s);
    q.pixel(x-1*s,y+3*s,c.side,16*s,4*s);q.pixel(x+1*s,y+7*s,c.ink,3*s,2*s);q.pixel(x+10*s,y+7*s,c.ink,3*s,2*s);
    const lamps=lane>0?light.hot:light.red;
    q.pixel(x,y+4*s,lamps,3*s,Math.max(1,s));q.pixel(x+11*s,y+4*s,lamps,3*s,Math.max(1,s));
    ctx.globalAlpha=.20*light.level;q.poly([[x,y+9*s],[x+3*s,y+9*s],[x+1*s,y+20*s],[x-2*s,y+20*s]],lane>0?c.warm:c.red);
    q.poly([[x+11*s,y+9*s],[x+14*s,y+9*s],[x+16*s,y+20*s],[x+12*s,y+20*s]],lane>0?c.warm:c.red);ctx.globalAlpha=1;
  }
  function tram(q,ctx,c,light,x,y) {
    q.pixel(x,y-5,c.ink,39,9);q.pixel(x+2,y-7,c.edge,34,2);
    q.pixel(x+1,y-4,c.face,37,6);q.pixel(x+3,y-3,light.warm,31,3);
    for(let i=0;i<6;i++)q.pixel(x+7+i*5,y-3,c.side,1,4);
    q.pixel(x+2,y+1,c.edge,35);q.pixel(x+5,y+3,c.ink,4,2);q.pixel(x+29,y+3,c.ink,4,2);
    q.pixel(x+36,y-1,light.hot,2,2);q.pixel(x+1,y-1,light.red);
    ctx.globalAlpha=.15*light.level;q.pixel(x+2,y+7,c.warm,35,2);ctx.globalAlpha=1;
  }
  function lantern(q,ctx,c,light,x,y,size) {
    q.glow(x,y,size*4,size*5,c.warm,.18*light.level);
    q.pixel(x-size,y-size,light.warm,size*2+1,size*2+2);q.pixel(x,y-size,light.hot,1,size*2);
    q.pixel(x-size,y-size-1,c.edge,size*2+1);q.pixel(x-size,y+size+2,c.edge,size*2+1);
    q.line(x,y+size+3,x-1,y+size+6,c.warm);
  }
  function terrace(q,ctx,c,light,t,catAction) {
    // A tiny occupied viewing terrace on the existing left-hand platform.
    q.pixel(25,237,c.ink,21,2);q.pixel(28,239,c.side,2,7);q.pixel(42,239,c.side,2,3);
    q.pixel(28,231,c.edge,11,2);q.pixel(33,233,c.ink,2,4);
    q.pixel(34,228,light.warm,2,3);q.pixel(36,229,c.warm,1,2);
    const steam=Math.floor(t*3)%4;
    ctx.globalAlpha=.30;q.pixel(34+(steam%2),225-steam,c.haze,1,2);q.pixel(35-(steam%2),222-steam,c.haze);ctx.globalAlpha=1;
    q.pixel(22,229,c.stone,3,3);q.pixel(21,232,c.side,5,5);q.line(24,234,30,232,c.edge);
    q.pixel(22,237,c.ink,2,4);q.pixel(25,237,c.ink,2,3);
    if(!catAction)cat(q,c,light,47,246,t,false);
  }
  function cat(q,c,light,x,y,t,playful) {
    const wag=Math.round(Math.sin(t*3)*2),stretch=playful?Math.round(Math.sin(t*4)*2):0;
    q.pixel(x-4,y-4,c.ink,8+stretch,4);q.pixel(x+3+stretch,y-7,c.ink,4,6);
    q.pixel(x-3,y-4,c.face,6+stretch,2);q.pixel(x+4+stretch,y-6,c.edge,2,3);
    q.pixel(x+3+stretch,y-8,c.ink);q.pixel(x+6+stretch,y-8,c.ink);
    q.pixel(x-4,y-1,c.ink,2,3);q.pixel(x+3+stretch,y-1,c.ink,2,3);
    q.line(x-4,y-3,x-8,y-5+wag,c.ink,2);q.pixel(x+6+stretch,y-5,light.green);
    q.pixel(x-3,y+1,c.edge);q.pixel(x+4+stretch,y+1,c.edge);
    if(playful){q.pixel(x+5+stretch,y-1,c.edge,4,1);q.pixel(x+8+stretch,y-2,c.edge);}
  }
  function livingCity(ctx,q,c,light,t,catAction) {
    // Several independent traffic rhythms make the vanishing-point avenue read
    // as a working road within seconds, without changing its cached geometry.
    for(let i=0;i<6;i++) {
      const lane=i%2===0?1:-1,phase=(t*(.070+(i%3)*.009)+i*.173+.14)%1;
      roadCar(q,ctx,c,light,lane>0?phase:1-phase,lane);
    }
    smallCar(q,ctx,c,light,(t*29+52)%550-32,181,.68,1);
    smallCar(q,ctx,c,light,516-(t*23+119)%550,182,.54,-1);
    smallCar(q,ctx,c,light,(t*35+327)%550-32,181,.64,1);
    tram(q,ctx,c,light,(t*17+212)%580-50,181);
    // A lit service carriage travels on the existing tower-side guide rail.
    const lift=130+Math.floor((.5+.5*Math.sin(t*.7))*39);
    q.pixel(408,lift,c.ink,5,7);q.pixel(409,lift+1,light.warm,3,4);q.pixel(409,lift+6,c.edge,3);
    const scan=65+Math.floor(t*9)%34;
    ctx.globalAlpha=.32*light.level;q.pixel(355,scan,c.green,43,2);ctx.globalAlpha=1;
    // Separate floor banks gently change occupancy; this is local glass light,
    // never a whole-scene brightness pulse or fake audio response.
    for(let i=0;i<3;i++){
      const row=(Math.floor(t*.45)+i*3)%8,x=355+i*12,y=119+row*7;
      ctx.globalAlpha=.48*light.level;q.pixel(x,y,i%2?c.warm:c.green,8,2);ctx.globalAlpha=1;
    }
    // Roof surveyor: short walk, pause, inspect, then return along the parapet.
    const walk=(t*.055)%1,workerX=306+Math.round((walk<.5?walk:1-walk)*18);
    q.pixel(workerX,96,c.stone,2,2);q.pixel(workerX-1,98,c.edge,4,3);
    q.pixel(workerX-1,101,c.ink);q.pixel(workerX+2,101,c.ink);
    q.pixel(workerX+3,98,light.warm,2);
    terrace(q,ctx,c,light,t,catAction);
    for(let i=0;i<2;i++) {
      const rise=(t*3.6+i*38+9)%100;
      lantern(q,ctx,c,light,191+i*34+Math.sin(t*.4+i)*5,151-rise,1);
    }
    // A recognisable courier craft crosses behind the tower, at a much slower
    // scale than foreground traffic. Its wing lights belong to the craft.
    const plane=(t*6.2+249)%550-30;
    q.line(plane-6,82,plane+5,82,c.edge);q.pixel(plane-1,80,c.side,4,3);
    q.pixel(plane+4,81,light.hot,2);q.pixel(plane-7,82,light.red);
    ctx.globalAlpha=.12;
    q.pixel((t*1.2+27)%600-120,109,c.haze,75);q.pixel((t*.7+298)%600-120,46,c.haze,43);
    ctx.globalAlpha=1;
  }
  function releasedLanterns(ctx,q,c,light,phase) {
    for(let i=0;i<8;i++) {
      const rise=clamp(phase*1.18-i*.052,0,1),x=178+i*8+rise*27+Math.sin(rise*5+i)*4,y=167-rise*(101+i%3*10);
      lantern(q,ctx,c,light,x,y,i%3===0?2:1);
    }
  }
  function puddles(ctx,q,c,light,phase) {
    // Rings stay inside the wet roadway, reflecting individual street lamps.
    for(let i=0;i<7;i++) {
      const x=288+(i*29)%117,y=221+(i*17)%39,radius=2+((phase*2+i*.14)%1)*12;
      ctx.globalAlpha=(.85-phase*.34)*light.level;
      q.ring(x,y,radius,radius*.23,i%2?c.warm:c.green);
      q.ring(x,y+1,Math.max(1,radius-2),Math.max(1,radius*.16),c.edge);
      q.pixel(x-radius*.6,y+3,c.warm,radius*1.2);
    }
    ctx.globalAlpha=1;
  }
  const actionRegions=[
    {action:'traffic',label:'Call the late tram',x:165,y:194,w:151,h:66},
    {action:'lanterns',label:'Release rooftop lanterns',x:176,y:42,w:125,h:103},
    {action:'cat',label:'Play with the terrace cat',x:17,y:216,w:50,h:41},
    {action:'signal',label:'Transmit from the tower',x:347,y:54,w:63,h:69},
    {action:'lights',label:'Switch the city lights',x:347,y:126,w:63,h:54},
    {action:'puddles',label:'Ripple the wet avenue',x:328,y:218,w:122,h:45}
  ].map(p=>({...p,x:p.x*2,y:p.y*2,w:p.w*2,h:p.h*2}));
  function weather(ctx,q,c,p,motion) {
    const n=p.intensity/100;if(n<=0)return;
    if(p.weather==='rain') {
      ctx.globalAlpha=.13+n*.26;
      for(let i=0;i<Math.round(35+n*100);i++) {
        const x=(i*83+17)%W,y=(i*53+motion*(34+i%6*7))%282-8;
        q.line(x,y,x-1-i%2,y+3+i%4,c.haze);
      }
      ctx.globalAlpha=.16*n;
      for(let i=0;i<21;i++) {const phase=(motion*.8+i*.167)%1,x=66+(i*47)%365,y=205+(i*23)%61;q.ring(x,y,1+phase*5,1,c.green);}
      ctx.globalAlpha=1;
    } else if(p.weather==='snow') {
      ctx.globalAlpha=.40+n*.25;
      for(let i=0;i<Math.round(20+n*62);i++) {const x=(i*83+Math.sin(motion*.25+i)*6+W)%W,y=(i*41+motion*(4+i%5))%276-3;q.pixel(x,y,c.hot,i%7===0?2:1,1);}
      ctx.globalAlpha=1;
    } else if(p.weather==='mist') {
      for(let i=0;i<4;i++) {ctx.globalAlpha=(.025+n*.032)*(i<2?1:.6);q.ellipse(218+Math.sin(motion*.04+i)*45,157+i*18,285,5+i*3,c.haze);}
      ctx.globalAlpha=1;
    }
  }
  function create(canvas) {
    if(!canvas||typeof canvas.getContext!=='function')throw new TypeError('Citylight requires a canvas');
    canvas.width=960;canvas.height=540;
    const context=canvas.getContext('2d',{alpha:false});if(!context)throw new Error('2D canvas unavailable');
    const document=canvas.ownerDocument||root.document;
    const makeCanvas=()=>{if(document&&typeof document.createElement==='function')return document.createElement('canvas');if(typeof root.OffscreenCanvas==='function')return new root.OffscreenCanvas(W,H);throw new Error('An offscreen canvas is required');};
    let cache=makeCanvas(),frame=makeCanvas();cache.width=frame.width=W;cache.height=frame.height=H;
    let cacheContext=cache.getContext('2d',{alpha:false}),frameContext=frame.getContext('2d',{alpha:false});
    if(!cacheContext||!frameContext)throw new Error('Offscreen 2D canvas unavailable');
    let prefs=normalize(),cacheKey='',bakes=0,frames=0,disposed=false,lightsEnabled=true,motion=0,lastTime=null,active=null;
    const q=tools(frameContext);
    function bake(p) {
      if(disposed)return;
      prefs=normalize(p);const key=prefs.palette+'|'+Math.round(prefs.worldGlow)+'|'+lightsEnabled;
      if(cacheKey===key)return;
      cacheContext.setTransform(1,0,0,1,0,0);cacheContext.globalAlpha=1;cacheContext.imageSmoothingEnabled=false;
      cachedArt(cacheContext,palettes[prefs.palette],prefs,lightsEnabled);cacheKey=key;bakes++;
    }
    function draw(timeSeconds,p) {
      if(disposed)return;bake(p);
      const time=Math.max(0,finite(timeSeconds,0)),delta=lastTime===null?0:clamp(time-lastTime,0,.25);lastTime=time;
      // Feature-off and activity-zero are honest still frames, including weather.
      // Manual actions use the host's explicit action clock and remain available.
      if(prefs.worldFeature)motion+=delta*prefs.worldActivity/100;
      const c=palettes[prefs.palette],light=emissions(c,prefs,lightsEnabled);
      const elapsed=active?time-active.at:0,phase=active?clamp(elapsed/active.duration,0,1):0;
      if(active&&elapsed>=active.duration)active=null;
      frameContext.setTransform(1,0,0,1,0,0);frameContext.globalAlpha=1;frameContext.imageSmoothingEnabled=false;frameContext.drawImage(cache,0,0);
      if(prefs.worldFeature)livingCity(frameContext,q,c,light,motion,active?.action==='cat');
      if(active&&active.action==='traffic') {
        for(let i=0;i<3;i++){
          const progress=clamp(.18+phase*1.13-i*.16,0,.995);if(progress>.02)roadCar(q,frameContext,c,light,progress,i===1?-1:1);
        }
        smallCar(q,frameContext,c,light,-35+phase*560,181,.88,1);
        tram(q,frameContext,c,light,-40+phase*560,181);
      }
      if(active&&active.action==='lanterns')releasedLanterns(frameContext,q,c,light,phase);
      if(active&&active.action==='cat') {
        const hop=Math.sin(phase*Math.PI*2),x=47+Math.sin(phase*Math.PI)*12,y=246-Math.max(0,hop)*5;
        cat(q,c,light,x,y,elapsed,true);
        q.pixel(62+Math.sin(phase*9)*3,246-Math.abs(Math.sin(phase*9))*3,c.warm,2,2);
      }
      if(active&&active.action==='signal') {
        const amount=Math.sin(phase*Math.PI),scan=64+Math.floor(phase*5%1*35);
        frameContext.globalAlpha=.35+amount*.38;q.pixel(355,scan,c.hot,43,2);frameContext.globalAlpha=.12*amount;
        q.poly([[377,27],[352-phase*80,58],[404+phase*93,58]],c.green);frameContext.globalAlpha=1;
        q.pixel(376,25,light.hot,3,3);
        for(let i=0;i<3;i++){frameContext.globalAlpha=Math.max(0,.7-phase*.7-i*.08);q.ring(377,28,7+phase*32+i*10,3+phase*12+i*4,c.green);}
        frameContext.globalAlpha=1;
      }
      if(active&&active.action==='puddles')puddles(frameContext,q,c,light,phase);
      weather(frameContext,q,c,prefs,motion);
      context.setTransform(1,0,0,1,0,0);context.globalAlpha=1;context.imageSmoothingEnabled=false;context.drawImage(frame,0,0,960,540);frames++;
    }
    function effect(action,timeSeconds) {
      if(disposed||!actionRegions.some(p=>p.action===action))return false;
      if(action==='lights'){lightsEnabled=!lightsEnabled;return true;}
      const duration={traffic:7,lanterns:7.5,cat:4.6,signal:4.6,puddles:4.2}[action];
      active={action,at:Math.max(0,finite(timeSeconds,lastTime===null?0:lastTime)),duration};return true;
    }
    function dispose() {
      if(disposed)return;disposed=true;active=null;cache.width=frame.width=1;cache.height=frame.height=1;cacheContext=null;frameContext=null;cache=null;frame=null;
    }
    function diagnostics() {
      return {id:'citylight',width:960,height:540,logicalWidth:W,logicalHeight:H,cacheBakes:bakes,frames,disposed,cacheBytes:disposed?0:W*H*8,lightsEnabled,activeAction:active?.action||null,activeEffects:active?1:0,motionTime:motion,ownsAnimationLoop:false,ownsListeners:false,ownsAudio:false,settings:{...prefs}};
    }
    function hotspots(){return disposed?[]:actionRegions.map(p=>({...p}));}
    function hitTest(x,y){if(disposed||!Number.isFinite(x)||!Number.isFinite(y))return null;const p=actionRegions.find(p=>x>=p.x&&x<p.x+p.w&&y>=p.y&&y<p.y+p.h);return p?{...p}:null;}
    return {bake,draw,effect,dispose,diagnostics,hotspots,hitTest};
  }
  root.SeneschalCitylight={create};
})(typeof window!=='undefined'?window:globalThis);
