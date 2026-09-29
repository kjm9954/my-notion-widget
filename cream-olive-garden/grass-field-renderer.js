const GrassFieldRenderer=(()=>{
  const clamp=x=>Math.max(0,Math.min(1,x));
  const smooth=x=>{const t=clamp(x);return t*t*(3-2*t);};
  const transitionDuration=(from,to)=>560+340*Math.min(1,Math.abs(to-from));
  // Friday completes the main garden. Saturday and Sunday add bonus flowers.
  const dayProgress=[0,.25,.5,.75,1,1.5,2];
  const idlePeriod=3.6;
  function buildField(width,height){
    const unit=Math.min(1.15,height/82,width/390);
    const left=Math.min(87,width*.12),right=width-Math.min(76,width*.115);
    return {unit,bushes:[
      {x:left+53*unit,y:height-10*unit,size:57*unit,sprite:1,initial:.72,start:.10,end:.95},
      {x:right-46*unit,y:height-10*unit,size:57*unit,sprite:0,initial:.75,start:.05,end:.91},
      {x:left,y:height-6*unit,size:94*unit,sprite:0,initial:.73,start:0,end:.90},
      {x:right,y:height-5*unit,size:88*unit,sprite:1,initial:.76,start:.08,end:1}
    ],sprigs:[
      {x:left+97*unit,y:height-6*unit,size:22*unit,sprite:2,initial:.65,start:.25,end:.94},
      {x:right-95*unit,y:height-7*unit,size:18*unit,sprite:3,initial:.55,start:.18,end:.93}
    ],flowers:[
      {x:left+64*unit,y:height-8*unit,length:28*unit,radius:8.5*unit,lean:-.08,kind:0,angle:-.12,bloomStart:.28,bloomEnd:.82},
      {x:left+81*unit,y:height-8*unit,length:21*unit,radius:7.7*unit,lean:.08,kind:0,angle:.15,bloomStart:.40,bloomEnd:.97},
      {x:right-35*unit,y:height-5*unit,length:26*unit,radius:8.2*unit,lean:-.1,kind:1,angle:.12,bloomStart:.42,bloomEnd:.92},
      {x:right-18*unit,y:height-4*unit,length:20*unit,radius:7.8*unit,lean:.04,kind:1,angle:-.15,bloomStart:.50,bloomEnd:1}
    ],weekendFlowers:[
      {x:left+36*unit,y:height-5*unit,length:36*unit,radius:8.7*unit,lean:-.08,kind:2,angle:-.10,start:0,end:.48},
      {x:right-61*unit,y:height-6*unit,length:29*unit,radius:8.5*unit,lean:.06,kind:2,angle:.13,start:.04,end:.5},
      {x:left-23*unit,y:height-5*unit,length:30*unit,radius:8.4*unit,lean:-.06,kind:1,angle:-.08,start:.5,end:.96},
      {x:right+29*unit,y:height-4*unit,length:31*unit,radius:9*unit,lean:.06,kind:0,angle:.10,start:.54,end:1}
    ]};
  }
  function fitLayout(ground,metadata,width,sceneHeight){return {sceneHeight,viewHeight:sceneHeight,crop:0};}
  function trace(ctx,contour){ctx.beginPath();contour.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();}
  function drawShrub(ctx,atlas,metadata,p,progress,motion){
    const sprite=metadata.shrubs[p.sprite];
    const grown=p.initial+(1-p.initial)*smooth((progress-p.start)/(p.end-p.start));
    const entrance=.35+.65*motion.entrance;
    const scale=p.size/sprite.bounds.width*grown*entrance;
    const phase=p.x*.019+p.sprite*.8;
    const paintedHeight=sprite.bounds.height*scale;
    const amplitude=Math.min(3.3,paintedHeight*.095);
    const wind=motion.wind*amplitude*(Math.sin(motion.time*(Math.PI*2/idlePeriod)+phase)+.18*Math.sin(motion.time*(Math.PI*4/idlePeriod)+phase*.7));
    // The same painted shrub stays rooted to the same point. A uniform scale
    // expands its volume without flattening it or changing the illustration.
    ctx.save();ctx.translate(p.x,p.y);
    // Visible canopy sway (up to about 4px), with no root drift or idle scaling.
    ctx.transform(1,0,-wind/Math.max(1,paintedHeight),1,0,0);
    ctx.scale(scale,scale);
    ctx.translate(-sprite.anchor.x,-sprite.anchor.y);
    trace(ctx,sprite.contour);ctx.clip();
    ctx.drawImage(atlas,sprite.cell.x,sprite.cell.y,sprite.cell.width,sprite.cell.height,0,0,sprite.cell.width,sprite.cell.height);
    ctx.restore();
  }
  function drawGround(ctx,ground,width,height){
    const depth=Math.min(19,height*.23),top=height-depth;
    ctx.save();ctx.beginPath();ctx.moveTo(0,top);
    for(let x=0;x<=width+8;x+=8)ctx.lineTo(x,top+1.7*Math.sin(x*.019)+.7*Math.sin(x*.047));
    ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.closePath();ctx.fillStyle='#c7d69b';ctx.fill();ctx.clip();
    if(ground){ctx.globalAlpha=.12;ctx.drawImage(ground,0,540,ground.width,ground.height-540,0,top,width,depth);ctx.globalAlpha=1;}
    // A few broad, quiet lawn flecks keep the small garden connected.
    for(let i=0;i<Math.ceil(width/60);i++){
      const x=i*61+23,y=top+5+(i*13%8),s=3+(i%3);
      ctx.beginPath();ctx.moveTo(x-s,y-2);ctx.lineTo(x+s,y);ctx.lineTo(x-s*.3,y+4);ctx.closePath();
      ctx.fillStyle=i%3?'#dde3b4':'#aec78a';ctx.globalAlpha=.7;ctx.fill();
    }
    ctx.restore();
  }
  function drawFlower(ctx,atlas,patches,p,progress){
    const stemGrowth=.52+.48*smooth(progress/.65);
    const tip={x:p.x+p.lean*p.length*stemGrowth,y:p.y-p.length*stemGrowth};
    const open=smooth((progress-p.bloomStart)/(p.bloomEnd-p.bloomStart));
    ctx.save();ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.quadraticCurveTo(p.x-p.lean*p.length*.3,p.y-p.length*stemGrowth*.45,tip.x,tip.y);
    ctx.strokeStyle='#4c8d43';ctx.lineWidth=1.5;ctx.lineCap='round';ctx.stroke();
    for(let side=-1;side<=1;side+=2){
      const y=p.y-p.length*stemGrowth*(side<0?.31:.45),l=p.length*(.10+.18*stemGrowth);
      ctx.beginPath();ctx.moveTo(p.x,y);ctx.quadraticCurveTo(p.x+side*l*.7,y-l*.95,p.x+side*l,y-l*.58);ctx.quadraticCurveTo(p.x+side*l*.82,y+.12*l,p.x,y);ctx.closePath();
      ctx.fillStyle=side<0?'#68a847':'#83b954';ctx.fill();
    }
    if(open<.42){
      const colored=smooth((progress-p.bloomStart+.08)/.18);
      ctx.save();ctx.translate(tip.x,tip.y);ctx.rotate(p.angle);
      ctx.beginPath();ctx.ellipse(0,-2,2.4+colored*.5,3.6+colored*.5,0,0,Math.PI*2);
      ctx.fillStyle=colored>.45?['#6773c1','#d99963','#c57079'][p.kind]:'#689c43';ctx.fill();
      ctx.beginPath();ctx.moveTo(-4,1);ctx.quadraticCurveTo(-3,-4,0,-2);ctx.quadraticCurveTo(3,-4,4,1);ctx.quadraticCurveTo(0,5,-4,1);ctx.fillStyle='#73a34a';ctx.fill();ctx.restore();
    }
    if(open>.015&&patches.flowers){
      const f=patches.flowers[p.kind];
      const scale=p.radius*2/f.diameter*(.24+.76*open);
      ctx.save();ctx.translate(tip.x,tip.y-1);ctx.rotate(p.angle*(.75+.25*open));
      ctx.scale(scale,scale);ctx.translate(-f.center.x,-f.center.y);
      ctx.beginPath();f.contour.forEach((pt,i)=>i?ctx.lineTo(pt[0],pt[1]):ctx.moveTo(pt[0],pt[1]));ctx.closePath();ctx.clip();
      ctx.drawImage(atlas,f.cell.x,f.cell.y,f.cell.width,f.cell.height,0,0,f.cell.width,f.cell.height);
      ctx.restore();
    }
    ctx.restore();
  }

  function draw(ctx,flowers,ground,metadata,progress,width=720,height=82,sceneHeight=height,shrubs,options={}){
    const motion={time:options.time||0,wind:options.wind||0,entrance:options.entrance===undefined?1:clamp(options.entrance)};
    ctx.clearRect(0,0,width,height);ctx.save();ctx.fillStyle='#fdf6ed';ctx.fillRect(0,0,width,height);
    drawGround(ctx,ground,width,height);
    const field=buildField(width,height);
    const baseProgress=clamp(progress),weekendProgress=clamp(progress-1);
    for(const p of field.bushes)drawShrub(ctx,shrubs,metadata,p,baseProgress,motion);
    for(const p of field.sprigs)drawShrub(ctx,shrubs,metadata,p,baseProgress,motion);
    for(const p of field.flowers){
      const wind=motion.wind*Math.sin(motion.time*(Math.PI*2/idlePeriod)+p.x*.021);
      drawFlower(ctx,flowers,metadata,{...p,length:p.length*(.4+.6*motion.entrance),radius:p.radius*(.4+.6*motion.entrance),lean:p.lean+wind*.14,angle:p.angle+wind*.085},baseProgress);
    }
    for(const p of field.weekendFlowers){
      const growth=smooth((weekendProgress-p.start)/(p.end-p.start));
      if(growth<=0)continue;
      const wind=motion.wind*Math.sin(motion.time*(Math.PI*2/idlePeriod)+p.x*.021+.45);
      const size=smooth(growth/.55)*(.4+.6*motion.entrance);
      drawFlower(ctx,flowers,metadata,{...p,length:p.length*size,radius:p.radius*size,lean:p.lean+wind*.14,angle:p.angle+wind*.085,bloomStart:.12,bloomEnd:.9},growth);
    }
    ctx.restore();
  }
  return {draw,buildField,dayProgress,idlePeriod,smooth,fitLayout,transitionDuration};
})();
if(typeof module!=='undefined')module.exports=GrassFieldRenderer;
