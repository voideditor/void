import{a8 as v,a3 as M,aG as j,_ as u,g as q,s as H,a as Y,b as Z,q as J,p as K,l as _,c as Q,D as X,H as ee,N as te,e as ae,y as re,F as ne}from"./index.js";import{p as ie}from"./chunk-4BX2VUAB.js";import{p as se}from"./treemap-75Q7IDZK.js";import{d as L}from"./arc.js";import{o as le}from"./ordinal.js";import"./XCircleIcon.js";import"./_baseUniq.js";import"./_basePickBy.js";import"./clone.js";import"./init.js";(function(){try{var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};e.SENTRY_RELEASE={id:"89d47079907d2835afe9a9922c276dbc3fbbe92f"}}catch{}})();try{(function(){var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{},a=new e.Error().stack;a&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[a]="607d7b30-cba5-46f7-8d2d-4e7c41024247",e._sentryDebugIdIdentifier="sentry-dbid-607d7b30-cba5-46f7-8d2d-4e7c41024247")})()}catch{}function oe(e,a){return a<e?-1:a>e?1:a>=e?0:NaN}function ce(e){return e}function de(){var e=ce,a=oe,g=null,w=v(0),s=v(M),o=v(0);function l(t){var n,c=(t=j(t)).length,p,S,m=0,d=new Array(c),i=new Array(c),y=+w.apply(this,arguments),b=Math.min(M,Math.max(-M,s.apply(this,arguments)-y)),h,A=Math.min(Math.abs(b)/c,o.apply(this,arguments)),T=A*(b<0?-1:1),f;for(n=0;n<c;++n)(f=i[d[n]=n]=+e(t[n],n,t))>0&&(m+=f);for(a!=null?d.sort(function(x,D){return a(i[x],i[D])}):g!=null&&d.sort(function(x,D){return g(t[x],t[D])}),n=0,S=m?(b-c*T)/m:0;n<c;++n,y=h)p=d[n],f=i[p],h=y+(f>0?f*S:0)+T,i[p]={data:t[p],index:n,value:f,startAngle:y,endAngle:h,padAngle:A};return i}return l.value=function(t){return arguments.length?(e=typeof t=="function"?t:v(+t),l):e},l.sortValues=function(t){return arguments.length?(a=t,g=null,l):a},l.sort=function(t){return arguments.length?(g=t,a=null,l):g},l.startAngle=function(t){return arguments.length?(w=typeof t=="function"?t:v(+t),l):w},l.endAngle=function(t){return arguments.length?(s=typeof t=="function"?t:v(+t),l):s},l.padAngle=function(t){return arguments.length?(o=typeof t=="function"?t:v(+t),l):o},l}var ue=ne.pie,F={sections:new Map,showData:!1},C=F.sections,N=F.showData,pe=structuredClone(ue),fe=u(()=>structuredClone(pe),"getConfig"),ge=u(()=>{C=new Map,N=F.showData,re()},"clear"),he=u(({label:e,value:a})=>{if(a<0)throw new Error(`"${e}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);C.has(e)||(C.set(e,a),_.debug(`added new section: ${e}, with value: ${a}`))},"addSection"),me=u(()=>C,"getSections"),ye=u(e=>{N=e},"setShowData"),ve=u(()=>N,"getShowData"),O={getConfig:fe,clear:ge,setDiagramTitle:K,getDiagramTitle:J,setAccTitle:Z,getAccTitle:Y,setAccDescription:H,getAccDescription:q,addSection:he,getSections:me,setShowData:ye,getShowData:ve},we=u((e,a)=>{ie(e,a),a.setShowData(e.showData),e.sections.map(a.addSection)},"populateDb"),Se={parse:u(async e=>{const a=await se("pie",e);_.debug(a),we(a,O)},"parse")},be=u(e=>`
  .pieCircle{
    stroke: ${e.pieStrokeColor};
    stroke-width : ${e.pieStrokeWidth};
    opacity : ${e.pieOpacity};
  }
  .pieOuterCircle{
    stroke: ${e.pieOuterStrokeColor};
    stroke-width: ${e.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${e.pieTitleTextSize};
    fill: ${e.pieTitleTextColor};
    font-family: ${e.fontFamily};
  }
  .slice {
    font-family: ${e.fontFamily};
    fill: ${e.pieSectionTextColor};
    font-size:${e.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${e.pieLegendTextColor};
    font-family: ${e.fontFamily};
    font-size: ${e.pieLegendTextSize};
  }
`,"getStyles"),xe=be,De=u(e=>{const a=[...e.values()].reduce((s,o)=>s+o,0),g=[...e.entries()].map(([s,o])=>({label:s,value:o})).filter(s=>s.value/a*100>=1).sort((s,o)=>o.value-s.value);return de().value(s=>s.value)(g)},"createPieArcs"),Ae=u((e,a,g,w)=>{_.debug(`rendering pie chart
`+e);const s=w.db,o=Q(),l=X(s.getConfig(),o.pie),t=40,n=18,c=4,p=450,S=p,m=ee(a),d=m.append("g");d.attr("transform","translate("+S/2+","+p/2+")");const{themeVariables:i}=o;let[y]=te(i.pieOuterStrokeWidth);y??(y=2);const b=l.textPosition,h=Math.min(S,p)/2-t,A=L().innerRadius(0).outerRadius(h),T=L().innerRadius(h*b).outerRadius(h*b);d.append("circle").attr("cx",0).attr("cy",0).attr("r",h+y/2).attr("class","pieOuterCircle");const f=s.getSections(),x=De(f),D=[i.pie1,i.pie2,i.pie3,i.pie4,i.pie5,i.pie6,i.pie7,i.pie8,i.pie9,i.pie10,i.pie11,i.pie12];let $=0;f.forEach(r=>{$+=r});const z=x.filter(r=>(r.data.value/$*100).toFixed(0)!=="0"),E=le(D);d.selectAll("mySlices").data(z).enter().append("path").attr("d",A).attr("fill",r=>E(r.data.label)).attr("class","pieCircle"),d.selectAll("mySlices").data(z).enter().append("text").text(r=>(r.data.value/$*100).toFixed(0)+"%").attr("transform",r=>"translate("+T.centroid(r)+")").style("text-anchor","middle").attr("class","slice"),d.append("text").text(s.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText");const G=[...f.entries()].map(([r,I])=>({label:r,value:I})),k=d.selectAll(".legend").data(G).enter().append("g").attr("class","legend").attr("transform",(r,I)=>{const W=n+c,B=W*G.length/2,V=12*n,U=I*W-B;return"translate("+V+","+U+")"});k.append("rect").attr("width",n).attr("height",n).style("fill",r=>E(r.label)).style("stroke",r=>E(r.label)),k.append("text").attr("x",n+c).attr("y",n-c).text(r=>s.getShowData()?`${r.label} [${r.value}]`:r.label);const P=Math.max(...k.selectAll("text").nodes().map(r=>(r==null?void 0:r.getBoundingClientRect().width)??0)),R=S+t+n+c+P;m.attr("viewBox",`0 0 ${R} ${p}`),ae(m,p,R,l.useMaxWidth)},"draw"),Te={draw:Ae},Ge={parser:Se,db:O,renderer:Te,styles:xe};export{Ge as diagram};
//# sourceMappingURL=pieDiagram-ADFJNKIX.js.map
