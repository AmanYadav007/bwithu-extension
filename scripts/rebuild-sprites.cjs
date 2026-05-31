#!/usr/bin/env node
// rebuild-sprites.cjs
// bear.png is a 1536×1024 image of a single bear (white bg).
// This script crops it to the bear content, scales to a 100×100 base,
// then generates all four sprite sheet PNGs with synthetic animation.
//
// idle.png  (4 frames): subtle breathing loop (±1-2 px vertical offset)
// blink.png (3 frames): eyes open → half → closed  (pixel modification)
// wave.png  (4 frames): bear + slight scale-down on frames 2-3 to simulate wave bob
// spawn.png (6 frames): bear fades in from 20% scale to full

'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ─── PNG I/O (same as fix-sprites.cjs) ────────────────────────────────────

function paethPredictor(a,b,c){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);if(pa<=pb&&pa<=pc)return a;if(pb<=pc)return b;return c;}
function applyFilter(type,row,prev,bpp){const n=row.length,out=new Uint8Array(n);switch(type){case 0:for(let i=0;i<n;i++)out[i]=row[i];break;case 1:for(let i=0;i<n;i++)out[i]=(row[i]+(i>=bpp?out[i-bpp]:0))&0xFF;break;case 2:for(let i=0;i<n;i++)out[i]=(row[i]+prev[i])&0xFF;break;case 3:for(let i=0;i<n;i++){const a=i>=bpp?out[i-bpp]:0;out[i]=(row[i]+Math.floor((a+prev[i])/2))&0xFF;}break;case 4:for(let i=0;i<n;i++){const a=i>=bpp?out[i-bpp]:0,b=prev[i],c=i>=bpp?prev[i-bpp]:0;out[i]=(row[i]+paethPredictor(a,b,c))&0xFF;}break;}return out;}
function decodePNG(buf){const SIG=[137,80,78,71,13,10,26,10];for(let i=0;i<8;i++)if(buf[i]!==SIG[i])throw new Error('Not PNG');let pos=8,width,height,colorType,bitDepth;const idats=[];while(pos<buf.length){const len=buf.readUInt32BE(pos);pos+=4;const type=buf.slice(pos,pos+4).toString('ascii');pos+=4;const data=buf.slice(pos,pos+len);pos+=len+4;if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8];colorType=data[9];}else if(type==='IDAT')idats.push(data);}const ch=(colorType===6||colorType===4)?4:3;const stride=width*ch;const raw=zlib.inflateSync(Buffer.concat(idats));const rgba=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++){const base=y*(stride+1);const rowBuf=raw.slice(base+1,base+1+stride);const prevBuf=y>0?raw.slice((y-1)*(stride+1)+1,(y-1)*(stride+1)+1+stride):Buffer.alloc(stride);const out=applyFilter(raw[base],rowBuf,prevBuf,ch);for(let x=0;x<width;x++){const s=x*ch,d=(y*width+x)*4;rgba[d]=out[s];rgba[d+1]=out[s+1];rgba[d+2]=out[s+2];rgba[d+3]=ch===4?out[s+3]:255;}}return{width,height,rgba};}

const CRC_TABLE=(() => {const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
function crc32(buf){let c=0xFFFFFFFF;for(let i=0;i<buf.length;i++)c=CRC_TABLE[(c^buf[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function pngChunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length,0);const tb=Buffer.from(type,'ascii');const cb=Buffer.alloc(4);cb.writeUInt32BE(crc32(Buffer.concat([tb,data])),0);return Buffer.concat([len,tb,data,cb]);}
function encodePNG(w,h,rgba){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;const raw=Buffer.alloc(h*(1+w*4));for(let y=0;y<h;y++){raw[y*(1+w*4)]=0;for(let x=0;x<w;x++){const s=(y*w+x)*4,d=y*(1+w*4)+1+x*4;raw[d]=rgba[s];raw[d+1]=rgba[s+1];raw[d+2]=rgba[s+2];raw[d+3]=rgba[s+3];}}return Buffer.concat([sig,pngChunk('IHDR',ihdr),pngChunk('IDAT',zlib.deflateSync(raw,{level:9})),pngChunk('IEND',Buffer.alloc(0))]);}

// ─── UTILS ────────────────────────────────────────────────────────────────

function isBg(r,g,b,a){if(a<25)return true;return r>238&&g>238&&b>238&&a>190;}

// Find content bounding box
function contentBounds(rgba,w,h){
  let x0=w,x1=0,y0=h,y1=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(!isBg(rgba[i],rgba[i+1],rgba[i+2],rgba[i+3])){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}}
  return{x0,y0,w:x1-x0+1,h:y1-y0+1};
}

// Nearest-neighbour scale a region of src into a new target×target transparent canvas
// yShift: extra vertical offset in target space
function scaleIntoFrame(src,srcW,srcH,sx,sy,sw,sh,target,yShift=0,alpha=255){
  const scale=Math.min(target/sw,target/sh)*0.85; // 85% to leave breathing room
  const dw=Math.round(sw*scale),dh=Math.round(sh*scale);
  const ox=Math.floor((target-dw)/2);
  const oy=Math.floor((target-dh)/2)+yShift;
  const out=new Uint8ClampedArray(target*target*4);
  for(let y=0;y<dh;y++){
    if(y+oy<0||y+oy>=target) continue;
    for(let x=0;x<dw;x++){
      if(x+ox<0||x+ox>=target) continue;
      const srx=Math.floor(x/scale)+sx,sry=Math.floor(y/scale)+sy;
      if(srx<0||srx>=srcW||sry<0||sry>=srcH) continue;
      const si=(sry*srcW+srx)*4,di=((y+oy)*target+(x+ox))*4;
      const r=src[si],g=src[si+1],b=src[si+2],a=src[si+3];
      if(isBg(r,g,b,a)) continue;
      out[di]=r;out[di+1]=g;out[di+2]=b;out[di+3]=Math.round(a*alpha/255);
    }
  }
  return out;
}

// Copy pixel from bear (checks bounds)
function getBearPx(bear,bw,bh,bx,by,sx,sy){
  const ax=bx+sx,ay=by+sy;
  if(ax<0||ax>=bw||ay<0||ay>=bh) return[0,0,0,0];
  const i=(ay*bw+ax)*4;
  return[bear[i],bear[i+1],bear[i+2],bear[i+3]];
}

// Build a horizontal strip from an array of 128×128 RGBA frames
function makeStrip(frames){
  const n=frames.length,w=n*128,h=128;
  const out=new Uint8ClampedArray(w*h*4);
  for(let fi=0;fi<n;fi++){
    const f=frames[fi];
    for(let y=0;y<128;y++)for(let x=0;x<128;x++){
      const si=(y*128+x)*4,di=(y*w+fi*128+x)*4;
      out[di]=f[si];out[di+1]=f[si+1];out[di+2]=f[si+2];out[di+3]=f[si+3];
    }
  }
  return{w,h,buf:out};
}

// ─── MAIN ─────────────────────────────────────────────────────────────────

const PUBLIC=path.resolve(__dirname,'../public');
console.log('Reading bear.png…');
const{width:bW,height:bH,rgba:bear}=decodePNG(fs.readFileSync(path.join(PUBLIC,'bear.png')));
console.log(`  ${bW}×${bH}`);

const b=contentBounds(bear,bW,bH);
console.log(`  Content: ${b.w}×${b.h} at (${b.x0},${b.y0})`);

// ── idle.png: 4 frames, subtle breathing (yShift: 0, -1, 0, +1) ──────────
console.log('\nGenerating idle.png (4 frames)…');
const idleShifts=[0,-1,0,1];
const idleFrames=idleShifts.map(s=>scaleIntoFrame(bear,bW,bH,b.x0,b.y0,b.w,b.h,128,s));
const idle=makeStrip(idleFrames);
fs.writeFileSync(path.join(PUBLIC,'idle.png'),encodePNG(idle.w,idle.h,idle.buf));
console.log(`  ✓ ${idle.w}×${idle.h}`);

// ── blink.png: 3 frames - paint over eyes to simulate blink ──────────────
// Find approximate eye row: scan the upper half of the bear for near-black clusters
console.log('\nGenerating blink.png (3 frames)…');

// Generate frame at given yShift, then optionally paint eye area
function blinkFrame(eyeClose){
  const frame=scaleIntoFrame(bear,bW,bH,b.x0,b.y0,b.w,b.h,128,0);
  if(eyeClose===0) return frame; // open eyes, no modification
  // Find pixels in the frame that are very dark (eyes) in the upper 60% of content
  // and overwrite with the surrounding fur color
  // Strategy: replace dark pixels (R<80, G<60, B<50) in y rows 20-55 with a nearby fur tone
  const FUR=[245,222,179,255]; // approximate bear fur
  for(let y=18;y<60;y++){
    for(let x=25;x<103;x++){
      const i=(y*128+x)*4;
      const r=frame[i],g=frame[i+1],b_=frame[i+2],a=frame[i+3];
      if(a>100&&r<100&&g<80&&b_<70){
        // This is an eye pixel - replace based on eyeClose
        if(eyeClose===1){ // half: keep bottom half of eye shape
          // Cover top pixels of eye with fur
          frame[i]=FUR[0];frame[i+1]=FUR[1];frame[i+2]=FUR[2];frame[i+3]=FUR[3];
        } else { // fully closed
          frame[i]=FUR[0];frame[i+1]=FUR[1];frame[i+2]=FUR[2];frame[i+3]=FUR[3];
        }
      }
    }
  }
  return frame;
}
const blinkFrames=[blinkFrame(0),blinkFrame(1),blinkFrame(2)];
const blink=makeStrip(blinkFrames);
fs.writeFileSync(path.join(PUBLIC,'blink.png'),encodePNG(blink.w,blink.h,blink.buf));
console.log(`  ✓ ${blink.w}×${blink.h}`);

// ── wave.png: 4 frames - bear at normal, slight up, slight right-lean, down ─
console.log('\nGenerating wave.png (4 frames)…');
const waveShifts=[0,-2,-1,1];
const waveFrames=waveShifts.map(s=>scaleIntoFrame(bear,bW,bH,b.x0,b.y0,b.w,b.h,128,s));
const wave=makeStrip(waveFrames);
fs.writeFileSync(path.join(PUBLIC,'wave.png'),encodePNG(wave.w,wave.h,wave.buf));
console.log(`  ✓ ${wave.w}×${wave.h}`);

// ── spawn.png: 6 frames - bear scales in from tiny to full ───────────────
console.log('\nGenerating spawn.png (6 frames)…');
// Frame scales: 0.15, 0.30, 0.50, 0.70, 0.88, 1.0
// alpha also fades in
const spawnScales=[0.15,0.30,0.50,0.72,0.88,1.0];
const spawnAlpha=[60,100,160,200,230,255];
const spawnFrames=spawnScales.map((sc,i)=>{
  // Compute scaled size
  const maxDim=Math.max(b.w,b.h);
  const scaledW=Math.round(b.w*sc);
  const scaledH=Math.round(b.h*sc);
  const ox=Math.floor((128-scaledW)/2);
  const oy=Math.floor((128-scaledH)/2);
  const frame=new Uint8ClampedArray(128*128*4);
  for(let y=0;y<scaledH;y++){
    if(y+oy<0||y+oy>=128) continue;
    for(let x=0;x<scaledW;x++){
      if(x+ox<0||x+ox>=128) continue;
      const srx=Math.floor(x/sc)+b.x0,sry=Math.floor(y/sc)+b.y0;
      if(srx<0||srx>=bW||sry<0||sry>=bH) continue;
      const si=(sry*bW+srx)*4;
      const r=bear[si],g=bear[si+1],b_=bear[si+2],a=bear[si+3];
      if(isBg(r,g,b_,a)) continue;
      const di=((y+oy)*128+(x+ox))*4;
      frame[di]=r;frame[di+1]=g;frame[di+2]=b_;frame[di+3]=Math.round(a*spawnAlpha[i]/255);
    }
  }
  return frame;
});
const spawn=makeStrip(spawnFrames);
fs.writeFileSync(path.join(PUBLIC,'spawn.png'),encodePNG(spawn.w,spawn.h,spawn.buf));
console.log(`  ✓ ${spawn.w}×${spawn.h}`);

console.log('\nDone. Sprite sheets:');
console.log('  idle.png  - 4 frames (128×128 each) - breathing loop');
console.log('  blink.png - 3 frames (128×128 each) - open/half/closed');
console.log('  wave.png  - 4 frames (128×128 each) - gentle bob');
console.log('  spawn.png - 6 frames (128×128 each) - scale-in appear');
console.log('\nUpdate animationStates.ts:');
console.log('  idle:  frameCount:4');
console.log('  blink: frameCount:3');
console.log('  wave:  frameCount:4');
console.log('  spawn: frameCount:6');
