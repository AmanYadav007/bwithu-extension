#!/usr/bin/env node
// fix-sprites.cjs
// Reads the AI-generated 1536×1024 sprite sheets, auto-detects the frame
// count by testing clean integer divisors, crops each frame to its bear,
// converts white backgrounds to transparent, scales to 128×128, and saves
// new horizontal strip PNGs ready for SpritePlayer.tsx.
// Zero npm dependencies - only Node.js built-ins.

'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ─── PNG DECODER ─────────────────────────────────────────────────────────────

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function applyFilter(type, row, prev, bpp) {
  const n = row.length, out = new Uint8Array(n);
  switch (type) {
    case 0: for (let i=0;i<n;i++) out[i]=row[i]; break;
    case 1: for (let i=0;i<n;i++) out[i]=(row[i]+(i>=bpp?out[i-bpp]:0))&0xFF; break;
    case 2: for (let i=0;i<n;i++) out[i]=(row[i]+prev[i])&0xFF; break;
    case 3: for (let i=0;i<n;i++){const a=i>=bpp?out[i-bpp]:0;out[i]=(row[i]+Math.floor((a+prev[i])/2))&0xFF;}break;
    case 4: for (let i=0;i<n;i++){const a=i>=bpp?out[i-bpp]:0,b=prev[i],c=i>=bpp?prev[i-bpp]:0;out[i]=(row[i]+paethPredictor(a,b,c))&0xFF;}break;
    default: throw new Error(`Unknown filter: ${type}`);
  }
  return out;
}

function decodePNG(buf) {
  const SIG=[137,80,78,71,13,10,26,10];
  for(let i=0;i<8;i++) if(buf[i]!==SIG[i]) throw new Error('Not a PNG');
  let pos=8, width, height, colorType, bitDepth;
  const idats=[];
  while(pos<buf.length){
    const len=buf.readUInt32BE(pos);pos+=4;
    const type=buf.slice(pos,pos+4).toString('ascii');pos+=4;
    const data=buf.slice(pos,pos+len);pos+=len+4;
    if(type==='IHDR'){
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      bitDepth=data[8];colorType=data[9];
      if(bitDepth!==8) throw new Error(`Unsupported bitDepth: ${bitDepth}`);
    } else if(type==='IDAT') idats.push(data);
  }
  const ch=(colorType===6||colorType===4)?4:3;
  const stride=width*ch;
  const raw=zlib.inflateSync(Buffer.concat(idats));
  const rgba=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++){
    const base=y*(stride+1);
    const rowBuf=raw.slice(base+1,base+1+stride);
    const prevBuf=y>0?raw.slice((y-1)*(stride+1)+1,(y-1)*(stride+1)+1+stride):Buffer.alloc(stride);
    const out=applyFilter(raw[base],rowBuf,prevBuf,ch);
    for(let x=0;x<width;x++){
      const s=x*ch,d=(y*width+x)*4;
      rgba[d]=out[s];rgba[d+1]=out[s+1];rgba[d+2]=out[s+2];rgba[d+3]=ch===4?out[s+3]:255;
    }
  }
  return {width,height,rgba};
}

// ─── PNG ENCODER ─────────────────────────────────────────────────────────────

const CRC_TABLE=(() => {
  const t=new Uint32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}
  return t;
})();

function crc32(buf){let c=0xFFFFFFFF;for(let i=0;i<buf.length;i++)c=CRC_TABLE[(c^buf[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}

function pngChunk(type,data){
  const len=Buffer.alloc(4);len.writeUInt32BE(data.length,0);
  const tb=Buffer.from(type,'ascii');
  const cb=Buffer.alloc(4);cb.writeUInt32BE(crc32(Buffer.concat([tb,data])),0);
  return Buffer.concat([len,tb,data,cb]);
}

function encodePNG(w,h,rgba){
  const sig=Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
  const raw=Buffer.alloc(h*(1+w*4));
  for(let y=0;y<h;y++){
    raw[y*(1+w*4)]=0;
    for(let x=0;x<w;x++){
      const s=(y*w+x)*4,d=y*(1+w*4)+1+x*4;
      raw[d]=rgba[s];raw[d+1]=rgba[s+1];raw[d+2]=rgba[s+2];raw[d+3]=rgba[s+3];
    }
  }
  return Buffer.concat([sig,pngChunk('IHDR',ihdr),pngChunk('IDAT',zlib.deflateSync(raw,{level:9})),pngChunk('IEND',Buffer.alloc(0))]);
}

// ─── IMAGE UTILS ─────────────────────────────────────────────────────────────

function isBg(r,g,b,a){
  if(a<25) return true;
  return r>238 && g>238 && b>238 && a>190;
}

function colOpacity(rgba,w,h,x){
  let n=0;
  for(let y=0;y<h;y++){const i=(y*w+x)*4;if(!isBg(rgba[i],rgba[i+1],rgba[i+2],rgba[i+3]))n++;}
  return n;
}

function scoreFrameCount(rgba,w,h,n){
  if(w%n!==0) return {n,frameW:0,score:-1};
  const fw=w/n;
  let qualFrames=0;
  for(let fi=0;fi<n;fi++){
    const x0=fi*fw, x1=x0+fw;
    let contentCols=0;
    for(let x=x0;x<x1;x++){
      if(colOpacity(rgba,w,h,x)>=h*0.04) contentCols++;
    }
    if(contentCols/fw>0.2) qualFrames++;
  }
  return {n,frameW:fw,score:qualFrames/n};
}

function detectFrameCount(rgba,w,h){
  const candidates=[3,4,6,8,12];
  let best={n:4,frameW:w/4,score:0};
  for(const n of candidates){
    const result=scoreFrameCount(rgba,w,h,n);
    if(w%n===0) console.log(`    N=${n} (${w/n}px): score=${result.score.toFixed(2)}`);
    if(result.score>best.score) best=result;
  }
  return best;
}

function contentBounds(rgba,w,h,x0,x1){
  let minX=x1,maxX=x0,minY=h,maxY=0;
  for(let y=0;y<h;y++){
    for(let x=x0;x<x1;x++){
      const i=(y*w+x)*4;
      if(!isBg(rgba[i],rgba[i+1],rgba[i+2],rgba[i+3])){
        if(x<minX)minX=x;if(x>maxX)maxX=x;
        if(y<minY)minY=y;if(y>maxY)maxY=y;
      }
    }
  }
  return{minX,maxX,minY,maxY};
}

function cropAndScale(rgba,w,h,bx,by,bw,bh,target){
  const pad=Math.max(4,Math.floor(Math.max(bw,bh)*0.08));
  const sx0=Math.max(0,bx-pad),sy0=Math.max(0,by-pad);
  const sx1=Math.min(w,bx+bw+pad),sy1=Math.min(h,by+bh+pad);
  const sw=sx1-sx0,sh=sy1-sy0;
  const scale=Math.min(target/sw,target/sh);
  const dw=Math.round(sw*scale),dh=Math.round(sh*scale);
  const ox=Math.floor((target-dw)/2),oy=Math.floor((target-dh)/2);
  const out=new Uint8ClampedArray(target*target*4);
  for(let y=0;y<dh;y++){
    for(let x=0;x<dw;x++){
      const srcX=Math.floor(x/scale)+sx0,srcY=Math.floor(y/scale)+sy0;
      const si=(srcY*w+srcX)*4,di=((y+oy)*target+(x+ox))*4;
      const r=rgba[si],g=rgba[si+1],b=rgba[si+2],a=rgba[si+3];
      if(isBg(r,g,b,a)){out[di+3]=0;}else{out[di]=r;out[di+1]=g;out[di+2]=b;out[di+3]=a;}
    }
  }
  return out;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

const FRAME_SIZE=128;
// Hint overrides (0 = auto-detect). Tune these if auto-detection is wrong.
const HINTS={idle:4, blink:0, wave:0, spawn:0};

const PUBLIC=path.resolve(__dirname,'../public');

for(const name of ['idle','blink','wave','spawn']){
  const inPath=path.join(PUBLIC,`${name}.png`);
  console.log(`\n── ${name}.png ────────────────────────────`);
  const{width,height,rgba}=decodePNG(fs.readFileSync(inPath));
  console.log(`  Source: ${width}×${height}`);

  const hint=HINTS[name];
  let frameW, nFrames;
  if(hint>0 && width%hint===0){
    nFrames=hint; frameW=width/hint;
    console.log(`  Using hint: ${nFrames} frames × ${frameW}px`);
  } else {
    console.log('  Testing frame counts…');
    const best=detectFrameCount(rgba,width,height);
    nFrames=best.n; frameW=best.frameW;
    console.log(`  → ${nFrames} frames × ${frameW}px (score ${best.score.toFixed(2)})`);
  }

  const outW=nFrames*FRAME_SIZE, outH=FRAME_SIZE;
  const outBuf=new Uint8ClampedArray(outW*outH*4);

  for(let fi=0;fi<nFrames;fi++){
    const fx0=fi*frameW, fx1=fx0+frameW;
    const b=contentBounds(rgba,width,height,fx0,fx1);
    if(b.minX>b.maxX){console.log(`  Frame ${fi}: empty - skip`);continue;}
    const bw=b.maxX-b.minX+1,bh=b.maxY-b.minY+1;
    const scaled=cropAndScale(rgba,width,height,b.minX,b.minY,bw,bh,FRAME_SIZE);
    const dx=fi*FRAME_SIZE;
    for(let y=0;y<FRAME_SIZE;y++){
      for(let x=0;x<FRAME_SIZE;x++){
        const si=(y*FRAME_SIZE+x)*4,di=(y*outW+dx+x)*4;
        outBuf[di]=scaled[si];outBuf[di+1]=scaled[si+1];
        outBuf[di+2]=scaled[si+2];outBuf[di+3]=scaled[si+3];
      }
    }
    console.log(`  Frame ${fi}: bear ${bw}×${bh} at (${b.minX},${b.minY})`);
  }

  fs.writeFileSync(inPath,encodePNG(outW,outH,outBuf));
  console.log(`  ✓ ${outW}×${outH} saved (${nFrames} frames of 128×128)`);
}

console.log('\nDone.\n');
