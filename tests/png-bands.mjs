// Read CFT's non-interlaced 8-bit RGB(A) screenshots without another runtime.
// Reject unsupported input; never silently treat a failed decode as no paint.
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

export function pngPixels(bytes) {
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  let width,height,channels;const parts=[];
  for(let offset=8;offset<bytes.length;) {
    const size=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+size);
    if(kind==='IHDR') {
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      assert.equal(data[8],8);assert.ok([2,6].includes(data[9]));assert.equal(data[12],0);
      channels=data[9]===2?3:4;
    }
    if(kind==='IDAT')parts.push(data);
    offset+=size+12;
  }
  assert.ok(width>0&&height>0&&channels);
  const packed=inflateSync(Buffer.concat(parts)),stride=width*channels,pixels=Buffer.alloc(height*stride);
  assert.equal(packed.length,height*(stride+1));
  const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
  for(let y=0;y<height;y++) {
    const filter=packed[y*(stride+1)];assert.ok(filter<=4);
    for(let x=0;x<stride;x++) {
      const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;
      const prediction=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
      pixels[i]=(packed[y*(stride+1)+1+x]+prediction)&255;
    }
  }
  return {width,height,pixel:(x,y)=>[...pixels.subarray((y*width+x)*channels,(y*width+x)*channels+3)]};
}

export function paintedBand(image, x, top, bottom, color) {
  const rows=[];
  for(let y=Math.max(0,Math.floor(top));y<Math.min(image.height,Math.ceil(bottom));y++) {
    for(let dx=-2;dx<=2;dx++) {
      const at=Math.floor(x)+dx;if(at<0||at>=image.width)continue;
      if(image.pixel(at,y).every((v,i)=>v===color[i])) {rows.push(y);break;}
    }
  }
  return rows.length?{top:rows[0],bottom:rows.at(-1)+1,height:rows.at(-1)+1-rows[0]}:null;
}
