import{_ as u,D as w,H as B,e as C,l as y,b as D,a as S,p as T,q as E,g as F,s as P,E as _,F as z,y as A}from"./index.js";import{p as W}from"./chunk-4BX2VUAB.js";import{p as I}from"./treemap-75Q7IDZK.js";import"./XCircleIcon.js";import"./_baseUniq.js";import"./_basePickBy.js";import"./clone.js";(function(){try{var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};e.SENTRY_RELEASE={id:"89d47079907d2835afe9a9922c276dbc3fbbe92f"}}catch{}})();try{(function(){var e=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{},t=new e.Error().stack;t&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[t]="56efd56b-da8b-4da1-9994-8ec04d825658",e._sentryDebugIdIdentifier="sentry-dbid-56efd56b-da8b-4da1-9994-8ec04d825658")})()}catch{}var N=z.packet,k,m=(k=class{constructor(){this.packet=[],this.setAccTitle=D,this.getAccTitle=S,this.setDiagramTitle=T,this.getDiagramTitle=E,this.getAccDescription=F,this.setAccDescription=P}getConfig(){const t=w({...N,..._().packet});return t.showBits&&(t.paddingY+=10),t}getPacket(){return this.packet}pushWord(t){t.length>0&&this.packet.push(t)}clear(){A(),this.packet=[]}},u(k,"PacketDB"),k),L=1e4,Y=u((e,t)=>{W(e,t);let o=-1,r=[],n=1;const{bitsPerRow:l}=t.getConfig();for(let{start:a,end:s,bits:c,label:d}of e.blocks){if(a!==void 0&&s!==void 0&&s<a)throw new Error(`Packet block ${a} - ${s} is invalid. End must be greater than start.`);if(a??(a=o+1),a!==o+1)throw new Error(`Packet block ${a} - ${s??a} is not contiguous. It should start from ${o+1}.`);if(c===0)throw new Error(`Packet block ${a} is invalid. Cannot have a zero bit field.`);for(s??(s=a+(c??1)-1),c??(c=s-a+1),o=s,y.debug(`Packet block ${a} - ${o} with label ${d}`);r.length<=l+1&&t.getPacket().length<L;){const[p,i]=M({start:a,end:s,bits:c,label:d},n,l);if(r.push(p),p.end+1===n*l&&(t.pushWord(r),r=[],n++),!i)break;({start:a,end:s,bits:c,label:d}=i)}}t.pushWord(r)},"populate"),M=u((e,t,o)=>{if(e.start===void 0)throw new Error("start should have been set during first phase");if(e.end===void 0)throw new Error("end should have been set during first phase");if(e.start>e.end)throw new Error(`Block start ${e.start} is greater than block end ${e.end}.`);if(e.end+1<=t*o)return[e,void 0];const r=t*o-1,n=t*o;return[{start:e.start,end:r,label:e.label,bits:r-e.start},{start:n,end:e.end,label:e.label,bits:e.end-n}]},"getNextFittingBlock"),v={parser:{yy:void 0},parse:u(async e=>{var r;const t=await I("packet",e),o=(r=v.parser)==null?void 0:r.yy;if(!(o instanceof m))throw new Error("parser.parser?.yy was not a PacketDB. This is due to a bug within Mermaid, please report this issue at https://github.com/mermaid-js/mermaid/issues.");y.debug(t),Y(t,o)},"parse")},R=u((e,t,o,r)=>{const n=r.db,l=n.getConfig(),{rowHeight:a,paddingY:s,bitWidth:c,bitsPerRow:d}=l,p=n.getPacket(),i=n.getDiagramTitle(),g=a+s,f=g*(p.length+1)-(i?0:a),h=c*d+2,b=B(t);b.attr("viewbox",`0 0 ${h} ${f}`),C(b,f,h,l.useMaxWidth);for(const[x,$]of p.entries())H(b,$,x,l);b.append("text").text(i).attr("x",h/2).attr("y",f-g/2).attr("dominant-baseline","middle").attr("text-anchor","middle").attr("class","packetTitle")},"draw"),H=u((e,t,o,{rowHeight:r,paddingX:n,paddingY:l,bitWidth:a,bitsPerRow:s,showBits:c})=>{const d=e.append("g"),p=o*(r+l)+l;for(const i of t){const g=i.start%s*a+1,f=(i.end-i.start+1)*a-n;if(d.append("rect").attr("x",g).attr("y",p).attr("width",f).attr("height",r).attr("class","packetBlock"),d.append("text").attr("x",g+f/2).attr("y",p+r/2).attr("class","packetLabel").attr("dominant-baseline","middle").attr("text-anchor","middle").text(i.label),!c)continue;const h=i.end===i.start,b=p-2;d.append("text").attr("x",g+(h?f/2:0)).attr("y",b).attr("class","packetByte start").attr("dominant-baseline","auto").attr("text-anchor",h?"middle":"start").text(i.start),h||d.append("text").attr("x",g+f).attr("y",b).attr("class","packetByte end").attr("dominant-baseline","auto").attr("text-anchor","end").text(i.end)}},"drawWord"),O={draw:R},j={byteFontSize:"10px",startByteColor:"black",endByteColor:"black",labelColor:"black",labelFontSize:"12px",titleColor:"black",titleFontSize:"14px",blockStrokeColor:"black",blockStrokeWidth:"1",blockFillColor:"#efefef"},q=u(({packet:e}={})=>{const t=w(j,e);return`
	.packetByte {
		font-size: ${t.byteFontSize};
	}
	.packetByte.start {
		fill: ${t.startByteColor};
	}
	.packetByte.end {
		fill: ${t.endByteColor};
	}
	.packetLabel {
		fill: ${t.labelColor};
		font-size: ${t.labelFontSize};
	}
	.packetTitle {
		fill: ${t.titleColor};
		font-size: ${t.titleFontSize};
	}
	.packetBlock {
		stroke: ${t.blockStrokeColor};
		stroke-width: ${t.blockStrokeWidth};
		fill: ${t.blockFillColor};
	}
	`},"styles"),Z={parser:v,get db(){return new m},renderer:O,styles:q};export{Z as diagram};
//# sourceMappingURL=diagram-S2PKOQOG.js.map
