// Connected-component bounding boxes of an alpha mask (used to slice foliage atlases).
const sharp=require('sharp');
module.exports = async function components(file, minArea=400, scale=4, thr=100){
  const m = await sharp(file).metadata();
  const w=Math.round(m.width/scale), h=Math.round(m.height/scale);
  const {data}=await sharp(file).extractChannel(m.channels===4?3:0).resize(w,h).raw().toBuffer({resolveWithObject:true});
  const lab=new Int32Array(w*h).fill(-1); const out=[];
  for(let i=0;i<w*h;i++){ if(data[i]<=thr||lab[i]>=0) continue;
    const st=[i]; lab[i]=out.length; let x0=1e9,y0=1e9,x1=-1,y1=-1,a=0;
    while(st.length){const p=st.pop();const x=p%w,y=(p/w)|0;a++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const q=ny*w+nx;if(data[q]>thr&&lab[q]<0){lab[q]=out.length;st.push(q);}}}
    out.push({x:x0*scale,y:y0*scale,w:(x1-x0+1)*scale,h:(y1-y0+1)*scale,area:a*scale*scale});
  }
  return out.filter(c=>c.area>=minArea).sort((a,b)=>b.area-a.area);
};
if (require.main===module) module.exports(process.argv[2], +(process.argv[3]||400)).then(r=>console.log(r.slice(0,20)));
