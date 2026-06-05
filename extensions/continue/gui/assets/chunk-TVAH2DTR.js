import{g as te}from"./chunk-55IACEB6.js";import{s as ee}from"./chunk-QN33PNHL.js";import{_ as f,l as b,c as F,r as se,u as ie,a as re,b as ae,g as ne,s as oe,p as le,q as ce,T as he,k as W,y as ue}from"./index.js";(function(){try{var t=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};t.SENTRY_RELEASE={id:"89d47079907d2835afe9a9922c276dbc3fbbe92f"}}catch{}})();try{(function(){var t=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{},e=new t.Error().stack;e&&(t._sentryDebugIds=t._sentryDebugIds||{},t._sentryDebugIds[e]="92bb25f7-7da2-49e0-943e-f584f8e32b3a",t._sentryDebugIdIdentifier="sentry-dbid-92bb25f7-7da2-49e0-943e-f584f8e32b3a")})()}catch{}var vt=(function(){var t=f(function(V,o,h,n){for(h=h||{},n=V.length;n--;h[V[n]]=o);return h},"o"),e=[1,2],s=[1,3],a=[1,4],i=[2,4],l=[1,9],d=[1,11],S=[1,16],p=[1,17],T=[1,18],_=[1,19],m=[1,33],k=[1,20],A=[1,21],$=[1,22],x=[1,23],I=[1,24],u=[1,26],L=[1,27],O=[1,28],N=[1,29],G=[1,30],P=[1,31],B=[1,32],at=[1,35],nt=[1,36],ot=[1,37],lt=[1,38],K=[1,34],y=[1,4,5,16,17,19,21,22,24,25,26,27,28,29,33,35,37,38,41,45,48,51,52,53,54,57],ct=[1,4,5,14,15,16,17,19,21,22,24,25,26,27,28,29,33,35,37,38,39,40,41,45,48,51,52,53,54,57],xt=[4,5,16,17,19,21,22,24,25,26,27,28,29,33,35,37,38,41,45,48,51,52,53,54,57],gt={trace:f(function(){},"trace"),yy:{},symbols_:{error:2,start:3,SPACE:4,NL:5,SD:6,document:7,line:8,statement:9,classDefStatement:10,styleStatement:11,cssClassStatement:12,idStatement:13,DESCR:14,"-->":15,HIDE_EMPTY:16,scale:17,WIDTH:18,COMPOSIT_STATE:19,STRUCT_START:20,STRUCT_STOP:21,STATE_DESCR:22,AS:23,ID:24,FORK:25,JOIN:26,CHOICE:27,CONCURRENT:28,note:29,notePosition:30,NOTE_TEXT:31,direction:32,acc_title:33,acc_title_value:34,acc_descr:35,acc_descr_value:36,acc_descr_multiline_value:37,CLICK:38,STRING:39,HREF:40,classDef:41,CLASSDEF_ID:42,CLASSDEF_STYLEOPTS:43,DEFAULT:44,style:45,STYLE_IDS:46,STYLEDEF_STYLEOPTS:47,class:48,CLASSENTITY_IDS:49,STYLECLASS:50,direction_tb:51,direction_bt:52,direction_rl:53,direction_lr:54,eol:55,";":56,EDGE_STATE:57,STYLE_SEPARATOR:58,left_of:59,right_of:60,$accept:0,$end:1},terminals_:{2:"error",4:"SPACE",5:"NL",6:"SD",14:"DESCR",15:"-->",16:"HIDE_EMPTY",17:"scale",18:"WIDTH",19:"COMPOSIT_STATE",20:"STRUCT_START",21:"STRUCT_STOP",22:"STATE_DESCR",23:"AS",24:"ID",25:"FORK",26:"JOIN",27:"CHOICE",28:"CONCURRENT",29:"note",31:"NOTE_TEXT",33:"acc_title",34:"acc_title_value",35:"acc_descr",36:"acc_descr_value",37:"acc_descr_multiline_value",38:"CLICK",39:"STRING",40:"HREF",41:"classDef",42:"CLASSDEF_ID",43:"CLASSDEF_STYLEOPTS",44:"DEFAULT",45:"style",46:"STYLE_IDS",47:"STYLEDEF_STYLEOPTS",48:"class",49:"CLASSENTITY_IDS",50:"STYLECLASS",51:"direction_tb",52:"direction_bt",53:"direction_rl",54:"direction_lr",56:";",57:"EDGE_STATE",58:"STYLE_SEPARATOR",59:"left_of",60:"right_of"},productions_:[0,[3,2],[3,2],[3,2],[7,0],[7,2],[8,2],[8,1],[8,1],[9,1],[9,1],[9,1],[9,1],[9,2],[9,3],[9,4],[9,1],[9,2],[9,1],[9,4],[9,3],[9,6],[9,1],[9,1],[9,1],[9,1],[9,4],[9,4],[9,1],[9,2],[9,2],[9,1],[9,5],[9,5],[10,3],[10,3],[11,3],[12,3],[32,1],[32,1],[32,1],[32,1],[55,1],[55,1],[13,1],[13,1],[13,3],[13,3],[30,1],[30,1]],performAction:f(function(o,h,n,g,E,r,Z){var c=r.length-1;switch(E){case 3:return g.setRootDoc(r[c]),r[c];case 4:this.$=[];break;case 5:r[c]!="nl"&&(r[c-1].push(r[c]),this.$=r[c-1]);break;case 6:case 7:this.$=r[c];break;case 8:this.$="nl";break;case 12:this.$=r[c];break;case 13:const tt=r[c-1];tt.description=g.trimColon(r[c]),this.$=tt;break;case 14:this.$={stmt:"relation",state1:r[c-2],state2:r[c]};break;case 15:const Tt=g.trimColon(r[c]);this.$={stmt:"relation",state1:r[c-3],state2:r[c-1],description:Tt};break;case 19:this.$={stmt:"state",id:r[c-3],type:"default",description:"",doc:r[c-1]};break;case 20:var U=r[c],X=r[c-2].trim();if(r[c].match(":")){var ut=r[c].split(":");U=ut[0],X=[X,ut[1]]}this.$={stmt:"state",id:U,type:"default",description:X};break;case 21:this.$={stmt:"state",id:r[c-3],type:"default",description:r[c-5],doc:r[c-1]};break;case 22:this.$={stmt:"state",id:r[c],type:"fork"};break;case 23:this.$={stmt:"state",id:r[c],type:"join"};break;case 24:this.$={stmt:"state",id:r[c],type:"choice"};break;case 25:this.$={stmt:"state",id:g.getDividerId(),type:"divider"};break;case 26:this.$={stmt:"state",id:r[c-1].trim(),note:{position:r[c-2].trim(),text:r[c].trim()}};break;case 29:this.$=r[c].trim(),g.setAccTitle(this.$);break;case 30:case 31:this.$=r[c].trim(),g.setAccDescription(this.$);break;case 32:this.$={stmt:"click",id:r[c-3],url:r[c-2],tooltip:r[c-1]};break;case 33:this.$={stmt:"click",id:r[c-3],url:r[c-1],tooltip:""};break;case 34:case 35:this.$={stmt:"classDef",id:r[c-1].trim(),classes:r[c].trim()};break;case 36:this.$={stmt:"style",id:r[c-1].trim(),styleClass:r[c].trim()};break;case 37:this.$={stmt:"applyClass",id:r[c-1].trim(),styleClass:r[c].trim()};break;case 38:g.setDirection("TB"),this.$={stmt:"dir",value:"TB"};break;case 39:g.setDirection("BT"),this.$={stmt:"dir",value:"BT"};break;case 40:g.setDirection("RL"),this.$={stmt:"dir",value:"RL"};break;case 41:g.setDirection("LR"),this.$={stmt:"dir",value:"LR"};break;case 44:case 45:this.$={stmt:"state",id:r[c].trim(),type:"default",description:""};break;case 46:this.$={stmt:"state",id:r[c-2].trim(),classes:[r[c].trim()],type:"default",description:""};break;case 47:this.$={stmt:"state",id:r[c-2].trim(),classes:[r[c].trim()],type:"default",description:""};break}},"anonymous"),table:[{3:1,4:e,5:s,6:a},{1:[3]},{3:5,4:e,5:s,6:a},{3:6,4:e,5:s,6:a},t([1,4,5,16,17,19,22,24,25,26,27,28,29,33,35,37,38,41,45,48,51,52,53,54,57],i,{7:7}),{1:[2,1]},{1:[2,2]},{1:[2,3],4:l,5:d,8:8,9:10,10:12,11:13,12:14,13:15,16:S,17:p,19:T,22:_,24:m,25:k,26:A,27:$,28:x,29:I,32:25,33:u,35:L,37:O,38:N,41:G,45:P,48:B,51:at,52:nt,53:ot,54:lt,57:K},t(y,[2,5]),{9:39,10:12,11:13,12:14,13:15,16:S,17:p,19:T,22:_,24:m,25:k,26:A,27:$,28:x,29:I,32:25,33:u,35:L,37:O,38:N,41:G,45:P,48:B,51:at,52:nt,53:ot,54:lt,57:K},t(y,[2,7]),t(y,[2,8]),t(y,[2,9]),t(y,[2,10]),t(y,[2,11]),t(y,[2,12],{14:[1,40],15:[1,41]}),t(y,[2,16]),{18:[1,42]},t(y,[2,18],{20:[1,43]}),{23:[1,44]},t(y,[2,22]),t(y,[2,23]),t(y,[2,24]),t(y,[2,25]),{30:45,31:[1,46],59:[1,47],60:[1,48]},t(y,[2,28]),{34:[1,49]},{36:[1,50]},t(y,[2,31]),{13:51,24:m,57:K},{42:[1,52],44:[1,53]},{46:[1,54]},{49:[1,55]},t(ct,[2,44],{58:[1,56]}),t(ct,[2,45],{58:[1,57]}),t(y,[2,38]),t(y,[2,39]),t(y,[2,40]),t(y,[2,41]),t(y,[2,6]),t(y,[2,13]),{13:58,24:m,57:K},t(y,[2,17]),t(xt,i,{7:59}),{24:[1,60]},{24:[1,61]},{23:[1,62]},{24:[2,48]},{24:[2,49]},t(y,[2,29]),t(y,[2,30]),{39:[1,63],40:[1,64]},{43:[1,65]},{43:[1,66]},{47:[1,67]},{50:[1,68]},{24:[1,69]},{24:[1,70]},t(y,[2,14],{14:[1,71]}),{4:l,5:d,8:8,9:10,10:12,11:13,12:14,13:15,16:S,17:p,19:T,21:[1,72],22:_,24:m,25:k,26:A,27:$,28:x,29:I,32:25,33:u,35:L,37:O,38:N,41:G,45:P,48:B,51:at,52:nt,53:ot,54:lt,57:K},t(y,[2,20],{20:[1,73]}),{31:[1,74]},{24:[1,75]},{39:[1,76]},{39:[1,77]},t(y,[2,34]),t(y,[2,35]),t(y,[2,36]),t(y,[2,37]),t(ct,[2,46]),t(ct,[2,47]),t(y,[2,15]),t(y,[2,19]),t(xt,i,{7:78}),t(y,[2,26]),t(y,[2,27]),{5:[1,79]},{5:[1,80]},{4:l,5:d,8:8,9:10,10:12,11:13,12:14,13:15,16:S,17:p,19:T,21:[1,81],22:_,24:m,25:k,26:A,27:$,28:x,29:I,32:25,33:u,35:L,37:O,38:N,41:G,45:P,48:B,51:at,52:nt,53:ot,54:lt,57:K},t(y,[2,32]),t(y,[2,33]),t(y,[2,21])],defaultActions:{5:[2,1],6:[2,2],47:[2,48],48:[2,49]},parseError:f(function(o,h){if(h.recoverable)this.trace(o);else{var n=new Error(o);throw n.hash=h,n}},"parseError"),parse:f(function(o){var h=this,n=[0],g=[],E=[null],r=[],Z=this.table,c="",U=0,X=0,ut=2,tt=1,Tt=r.slice.call(arguments,1),D=Object.create(this.lexer),j={yy:{}};for(var Et in this.yy)Object.prototype.hasOwnProperty.call(this.yy,Et)&&(j.yy[Et]=this.yy[Et]);D.setInput(o,j.yy),j.yy.lexer=D,j.yy.parser=this,typeof D.yylloc>"u"&&(D.yylloc={});var _t=D.yylloc;r.push(_t);var Qt=D.options&&D.options.ranges;typeof j.yy.parseError=="function"?this.parseError=j.yy.parseError:this.parseError=Object.getPrototypeOf(this).parseError;function Zt(R){n.length=n.length-2*R,E.length=E.length-R,r.length=r.length-R}f(Zt,"popStack");function Lt(){var R;return R=g.pop()||D.lex()||tt,typeof R!="number"&&(R instanceof Array&&(g=R,R=g.pop()),R=h.symbols_[R]||R),R}f(Lt,"lex");for(var C,H,w,mt,J={},dt,Y,Rt,ft;;){if(H=n[n.length-1],this.defaultActions[H]?w=this.defaultActions[H]:((C===null||typeof C>"u")&&(C=Lt()),w=Z[H]&&Z[H][C]),typeof w>"u"||!w.length||!w[0]){var bt="";ft=[];for(dt in Z[H])this.terminals_[dt]&&dt>ut&&ft.push("'"+this.terminals_[dt]+"'");D.showPosition?bt="Parse error on line "+(U+1)+`:
`+D.showPosition()+`
Expecting `+ft.join(", ")+", got '"+(this.terminals_[C]||C)+"'":bt="Parse error on line "+(U+1)+": Unexpected "+(C==tt?"end of input":"'"+(this.terminals_[C]||C)+"'"),this.parseError(bt,{text:D.match,token:this.terminals_[C]||C,line:D.yylineno,loc:_t,expected:ft})}if(w[0]instanceof Array&&w.length>1)throw new Error("Parse Error: multiple actions possible at state: "+H+", token: "+C);switch(w[0]){case 1:n.push(C),E.push(D.yytext),r.push(D.yylloc),n.push(w[1]),C=null,X=D.yyleng,c=D.yytext,U=D.yylineno,_t=D.yylloc;break;case 2:if(Y=this.productions_[w[1]][1],J.$=E[E.length-Y],J._$={first_line:r[r.length-(Y||1)].first_line,last_line:r[r.length-1].last_line,first_column:r[r.length-(Y||1)].first_column,last_column:r[r.length-1].last_column},Qt&&(J._$.range=[r[r.length-(Y||1)].range[0],r[r.length-1].range[1]]),mt=this.performAction.apply(J,[c,X,U,j.yy,w[1],E,r].concat(Tt)),typeof mt<"u")return mt;Y&&(n=n.slice(0,-1*Y*2),E=E.slice(0,-1*Y),r=r.slice(0,-1*Y)),n.push(this.productions_[w[1]][0]),E.push(J.$),r.push(J._$),Rt=Z[n[n.length-2]][n[n.length-1]],n.push(Rt);break;case 3:return!0}}return!0},"parse")},qt=(function(){var V={EOF:1,parseError:f(function(h,n){if(this.yy.parser)this.yy.parser.parseError(h,n);else throw new Error(h)},"parseError"),setInput:f(function(o,h){return this.yy=h||this.yy||{},this._input=o,this._more=this._backtrack=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges&&(this.yylloc.range=[0,0]),this.offset=0,this},"setInput"),input:f(function(){var o=this._input[0];this.yytext+=o,this.yyleng++,this.offset++,this.match+=o,this.matched+=o;var h=o.match(/(?:\r\n?|\n).*/g);return h?(this.yylineno++,this.yylloc.last_line++):this.yylloc.last_column++,this.options.ranges&&this.yylloc.range[1]++,this._input=this._input.slice(1),o},"input"),unput:f(function(o){var h=o.length,n=o.split(/(?:\r\n?|\n)/g);this._input=o+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-h),this.offset-=h;var g=this.match.split(/(?:\r\n?|\n)/g);this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),n.length-1&&(this.yylineno-=n.length-1);var E=this.yylloc.range;return this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:n?(n.length===g.length?this.yylloc.first_column:0)+g[g.length-n.length].length-n[0].length:this.yylloc.first_column-h},this.options.ranges&&(this.yylloc.range=[E[0],E[0]+this.yyleng-h]),this.yyleng=this.yytext.length,this},"unput"),more:f(function(){return this._more=!0,this},"more"),reject:f(function(){if(this.options.backtrack_lexer)this._backtrack=!0;else return this.parseError("Lexical error on line "+(this.yylineno+1)+`. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
`+this.showPosition(),{text:"",token:null,line:this.yylineno});return this},"reject"),less:f(function(o){this.unput(this.match.slice(o))},"less"),pastInput:f(function(){var o=this.matched.substr(0,this.matched.length-this.match.length);return(o.length>20?"...":"")+o.substr(-20).replace(/\n/g,"")},"pastInput"),upcomingInput:f(function(){var o=this.match;return o.length<20&&(o+=this._input.substr(0,20-o.length)),(o.substr(0,20)+(o.length>20?"...":"")).replace(/\n/g,"")},"upcomingInput"),showPosition:f(function(){var o=this.pastInput(),h=new Array(o.length+1).join("-");return o+this.upcomingInput()+`
`+h+"^"},"showPosition"),test_match:f(function(o,h){var n,g,E;if(this.options.backtrack_lexer&&(E={yylineno:this.yylineno,yylloc:{first_line:this.yylloc.first_line,last_line:this.last_line,first_column:this.yylloc.first_column,last_column:this.yylloc.last_column},yytext:this.yytext,match:this.match,matches:this.matches,matched:this.matched,yyleng:this.yyleng,offset:this.offset,_more:this._more,_input:this._input,yy:this.yy,conditionStack:this.conditionStack.slice(0),done:this.done},this.options.ranges&&(E.yylloc.range=this.yylloc.range.slice(0))),g=o[0].match(/(?:\r\n?|\n).*/g),g&&(this.yylineno+=g.length),this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:g?g[g.length-1].length-g[g.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+o[0].length},this.yytext+=o[0],this.match+=o[0],this.matches=o,this.yyleng=this.yytext.length,this.options.ranges&&(this.yylloc.range=[this.offset,this.offset+=this.yyleng]),this._more=!1,this._backtrack=!1,this._input=this._input.slice(o[0].length),this.matched+=o[0],n=this.performAction.call(this,this.yy,this,h,this.conditionStack[this.conditionStack.length-1]),this.done&&this._input&&(this.done=!1),n)return n;if(this._backtrack){for(var r in E)this[r]=E[r];return!1}return!1},"test_match"),next:f(function(){if(this.done)return this.EOF;this._input||(this.done=!0);var o,h,n,g;this._more||(this.yytext="",this.match="");for(var E=this._currentRules(),r=0;r<E.length;r++)if(n=this._input.match(this.rules[E[r]]),n&&(!h||n[0].length>h[0].length)){if(h=n,g=r,this.options.backtrack_lexer){if(o=this.test_match(n,E[r]),o!==!1)return o;if(this._backtrack){h=!1;continue}else return!1}else if(!this.options.flex)break}return h?(o=this.test_match(h,E[g]),o!==!1?o:!1):this._input===""?this.EOF:this.parseError("Lexical error on line "+(this.yylineno+1)+`. Unrecognized text.
`+this.showPosition(),{text:"",token:null,line:this.yylineno})},"next"),lex:f(function(){var h=this.next();return h||this.lex()},"lex"),begin:f(function(h){this.conditionStack.push(h)},"begin"),popState:f(function(){var h=this.conditionStack.length-1;return h>0?this.conditionStack.pop():this.conditionStack[0]},"popState"),_currentRules:f(function(){return this.conditionStack.length&&this.conditionStack[this.conditionStack.length-1]?this.conditions[this.conditionStack[this.conditionStack.length-1]].rules:this.conditions.INITIAL.rules},"_currentRules"),topState:f(function(h){return h=this.conditionStack.length-1-Math.abs(h||0),h>=0?this.conditionStack[h]:"INITIAL"},"topState"),pushState:f(function(h){this.begin(h)},"pushState"),stateStackSize:f(function(){return this.conditionStack.length},"stateStackSize"),options:{"case-insensitive":!0},performAction:f(function(h,n,g,E){switch(g){case 0:return 38;case 1:return 40;case 2:return 39;case 3:return 44;case 4:return 51;case 5:return 52;case 6:return 53;case 7:return 54;case 8:break;case 9:break;case 10:return 5;case 11:break;case 12:break;case 13:break;case 14:break;case 15:return this.pushState("SCALE"),17;case 16:return 18;case 17:this.popState();break;case 18:return this.begin("acc_title"),33;case 19:return this.popState(),"acc_title_value";case 20:return this.begin("acc_descr"),35;case 21:return this.popState(),"acc_descr_value";case 22:this.begin("acc_descr_multiline");break;case 23:this.popState();break;case 24:return"acc_descr_multiline_value";case 25:return this.pushState("CLASSDEF"),41;case 26:return this.popState(),this.pushState("CLASSDEFID"),"DEFAULT_CLASSDEF_ID";case 27:return this.popState(),this.pushState("CLASSDEFID"),42;case 28:return this.popState(),43;case 29:return this.pushState("CLASS"),48;case 30:return this.popState(),this.pushState("CLASS_STYLE"),49;case 31:return this.popState(),50;case 32:return this.pushState("STYLE"),45;case 33:return this.popState(),this.pushState("STYLEDEF_STYLES"),46;case 34:return this.popState(),47;case 35:return this.pushState("SCALE"),17;case 36:return 18;case 37:this.popState();break;case 38:this.pushState("STATE");break;case 39:return this.popState(),n.yytext=n.yytext.slice(0,-8).trim(),25;case 40:return this.popState(),n.yytext=n.yytext.slice(0,-8).trim(),26;case 41:return this.popState(),n.yytext=n.yytext.slice(0,-10).trim(),27;case 42:return this.popState(),n.yytext=n.yytext.slice(0,-8).trim(),25;case 43:return this.popState(),n.yytext=n.yytext.slice(0,-8).trim(),26;case 44:return this.popState(),n.yytext=n.yytext.slice(0,-10).trim(),27;case 45:return 51;case 46:return 52;case 47:return 53;case 48:return 54;case 49:this.pushState("STATE_STRING");break;case 50:return this.pushState("STATE_ID"),"AS";case 51:return this.popState(),"ID";case 52:this.popState();break;case 53:return"STATE_DESCR";case 54:return 19;case 55:this.popState();break;case 56:return this.popState(),this.pushState("struct"),20;case 57:break;case 58:return this.popState(),21;case 59:break;case 60:return this.begin("NOTE"),29;case 61:return this.popState(),this.pushState("NOTE_ID"),59;case 62:return this.popState(),this.pushState("NOTE_ID"),60;case 63:this.popState(),this.pushState("FLOATING_NOTE");break;case 64:return this.popState(),this.pushState("FLOATING_NOTE_ID"),"AS";case 65:break;case 66:return"NOTE_TEXT";case 67:return this.popState(),"ID";case 68:return this.popState(),this.pushState("NOTE_TEXT"),24;case 69:return this.popState(),n.yytext=n.yytext.substr(2).trim(),31;case 70:return this.popState(),n.yytext=n.yytext.slice(0,-8).trim(),31;case 71:return 6;case 72:return 6;case 73:return 16;case 74:return 57;case 75:return 24;case 76:return n.yytext=n.yytext.trim(),14;case 77:return 15;case 78:return 28;case 79:return 58;case 80:return 5;case 81:return"INVALID"}},"anonymous"),rules:[/^(?:click\b)/i,/^(?:href\b)/i,/^(?:"[^"]*")/i,/^(?:default\b)/i,/^(?:.*direction\s+TB[^\n]*)/i,/^(?:.*direction\s+BT[^\n]*)/i,/^(?:.*direction\s+RL[^\n]*)/i,/^(?:.*direction\s+LR[^\n]*)/i,/^(?:%%(?!\{)[^\n]*)/i,/^(?:[^\}]%%[^\n]*)/i,/^(?:[\n]+)/i,/^(?:[\s]+)/i,/^(?:((?!\n)\s)+)/i,/^(?:#[^\n]*)/i,/^(?:%[^\n]*)/i,/^(?:scale\s+)/i,/^(?:\d+)/i,/^(?:\s+width\b)/i,/^(?:accTitle\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*\{\s*)/i,/^(?:[\}])/i,/^(?:[^\}]*)/i,/^(?:classDef\s+)/i,/^(?:DEFAULT\s+)/i,/^(?:\w+\s+)/i,/^(?:[^\n]*)/i,/^(?:class\s+)/i,/^(?:(\w+)+((,\s*\w+)*))/i,/^(?:[^\n]*)/i,/^(?:style\s+)/i,/^(?:[\w,]+\s+)/i,/^(?:[^\n]*)/i,/^(?:scale\s+)/i,/^(?:\d+)/i,/^(?:\s+width\b)/i,/^(?:state\s+)/i,/^(?:.*<<fork>>)/i,/^(?:.*<<join>>)/i,/^(?:.*<<choice>>)/i,/^(?:.*\[\[fork\]\])/i,/^(?:.*\[\[join\]\])/i,/^(?:.*\[\[choice\]\])/i,/^(?:.*direction\s+TB[^\n]*)/i,/^(?:.*direction\s+BT[^\n]*)/i,/^(?:.*direction\s+RL[^\n]*)/i,/^(?:.*direction\s+LR[^\n]*)/i,/^(?:["])/i,/^(?:\s*as\s+)/i,/^(?:[^\n\{]*)/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:[^\n\s\{]+)/i,/^(?:\n)/i,/^(?:\{)/i,/^(?:%%(?!\{)[^\n]*)/i,/^(?:\})/i,/^(?:[\n])/i,/^(?:note\s+)/i,/^(?:left of\b)/i,/^(?:right of\b)/i,/^(?:")/i,/^(?:\s*as\s*)/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:[^\n]*)/i,/^(?:\s*[^:\n\s\-]+)/i,/^(?:\s*:[^:\n;]+)/i,/^(?:[\s\S]*?end note\b)/i,/^(?:stateDiagram\s+)/i,/^(?:stateDiagram-v2\s+)/i,/^(?:hide empty description\b)/i,/^(?:\[\*\])/i,/^(?:[^:\n\s\-\{]+)/i,/^(?:\s*:[^:\n;]+)/i,/^(?:-->)/i,/^(?:--)/i,/^(?::::)/i,/^(?:$)/i,/^(?:.)/i],conditions:{LINE:{rules:[12,13],inclusive:!1},struct:{rules:[12,13,25,29,32,38,45,46,47,48,57,58,59,60,74,75,76,77,78],inclusive:!1},FLOATING_NOTE_ID:{rules:[67],inclusive:!1},FLOATING_NOTE:{rules:[64,65,66],inclusive:!1},NOTE_TEXT:{rules:[69,70],inclusive:!1},NOTE_ID:{rules:[68],inclusive:!1},NOTE:{rules:[61,62,63],inclusive:!1},STYLEDEF_STYLEOPTS:{rules:[],inclusive:!1},STYLEDEF_STYLES:{rules:[34],inclusive:!1},STYLE_IDS:{rules:[],inclusive:!1},STYLE:{rules:[33],inclusive:!1},CLASS_STYLE:{rules:[31],inclusive:!1},CLASS:{rules:[30],inclusive:!1},CLASSDEFID:{rules:[28],inclusive:!1},CLASSDEF:{rules:[26,27],inclusive:!1},acc_descr_multiline:{rules:[23,24],inclusive:!1},acc_descr:{rules:[21],inclusive:!1},acc_title:{rules:[19],inclusive:!1},SCALE:{rules:[16,17,36,37],inclusive:!1},ALIAS:{rules:[],inclusive:!1},STATE_ID:{rules:[51],inclusive:!1},STATE_STRING:{rules:[52,53],inclusive:!1},FORK_STATE:{rules:[],inclusive:!1},STATE:{rules:[12,13,39,40,41,42,43,44,49,50,54,55,56],inclusive:!1},ID:{rules:[12,13],inclusive:!1},INITIAL:{rules:[0,1,2,3,4,5,6,7,8,9,10,11,13,14,15,18,20,22,25,29,32,35,38,56,60,71,72,73,74,75,76,77,79,80,81],inclusive:!0}}};return V})();gt.lexer=qt;function ht(){this.yy={}}return f(ht,"Parser"),ht.prototype=gt,gt.Parser=ht,new ht})();vt.parser=vt;var Be=vt,de="TB",Yt="TB",It="dir",Q="state",q="root",Ct="relation",fe="classDef",pe="style",Se="applyClass",it="default",Gt="divider",Bt="fill:none",Vt="fill: #333",Mt="c",Ut="text",jt="normal",Dt="rect",kt="rectWithTitle",ye="stateStart",ge="stateEnd",Ot="divider",Nt="roundedWithTitle",Te="note",Ee="noteGroup",rt="statediagram",_e="state",me=`${rt}-${_e}`,Ht="transition",be="note",De="note-edge",ke=`${Ht} ${De}`,ve=`${rt}-${be}`,Ce="cluster",Ae=`${rt}-${Ce}`,xe="cluster-alt",Le=`${rt}-${xe}`,Wt="parent",zt="note",Re="state",At="----",Ie=`${At}${zt}`,wt=`${At}${Wt}`,Kt=f((t,e=Yt)=>{if(!t.doc)return e;let s=e;for(const a of t.doc)a.stmt==="dir"&&(s=a.value);return s},"getDir"),Oe=f(function(t,e){return e.db.getClasses()},"getClasses"),Ne=f(async function(t,e,s,a){b.info("REF0:"),b.info("Drawing state diagram (v2)",e);const{securityLevel:i,state:l,layout:d}=F();a.db.extract(a.db.getRootDocV2());const S=a.db.getData(),p=te(e,i);S.type=a.type,S.layoutAlgorithm=d,S.nodeSpacing=(l==null?void 0:l.nodeSpacing)||50,S.rankSpacing=(l==null?void 0:l.rankSpacing)||50,S.markers=["barb"],S.diagramId=e,await se(S,p);const T=8;try{(typeof a.db.getLinks=="function"?a.db.getLinks():new Map).forEach((m,k)=>{var O;const A=typeof k=="string"?k:typeof(k==null?void 0:k.id)=="string"?k.id:"";if(!A){b.warn("⚠️ Invalid or missing stateId from key:",JSON.stringify(k));return}const $=(O=p.node())==null?void 0:O.querySelectorAll("g");let x;if($==null||$.forEach(N=>{var P;((P=N.textContent)==null?void 0:P.trim())===A&&(x=N)}),!x){b.warn("⚠️ Could not find node matching text:",A);return}const I=x.parentNode;if(!I){b.warn("⚠️ Node has no parent, cannot wrap:",A);return}const u=document.createElementNS("http://www.w3.org/2000/svg","a"),L=m.url.replace(/^"+|"+$/g,"");if(u.setAttributeNS("http://www.w3.org/1999/xlink","xlink:href",L),u.setAttribute("target","_blank"),m.tooltip){const N=m.tooltip.replace(/^"+|"+$/g,"");u.setAttribute("title",N)}I.replaceChild(u,x),u.appendChild(x),b.info("🔗 Wrapped node in <a> tag for:",A,m.url)})}catch(_){b.error("❌ Error injecting clickable links:",_)}ie.insertTitle(p,"statediagramTitleText",(l==null?void 0:l.titleTopMargin)??25,a.db.getDiagramTitle()),ee(p,T,rt,(l==null?void 0:l.useMaxWidth)??!0)},"draw"),Ve={getClasses:Oe,draw:Ne,getDir:Kt},St=new Map,M=0;function yt(t="",e=0,s="",a=At){const i=s!==null&&s.length>0?`${a}${s}`:"";return`${Re}-${t}${i}-${e}`}f(yt,"stateDomId");var we=f((t,e,s,a,i,l,d,S)=>{b.trace("items",e),e.forEach(p=>{switch(p.stmt){case Q:st(t,p,s,a,i,l,d,S);break;case it:st(t,p,s,a,i,l,d,S);break;case Ct:{st(t,p.state1,s,a,i,l,d,S),st(t,p.state2,s,a,i,l,d,S);const T={id:"edge"+M,start:p.state1.id,end:p.state2.id,arrowhead:"normal",arrowTypeEnd:"arrow_barb",style:Bt,labelStyle:"",label:W.sanitizeText(p.description??"",F()),arrowheadStyle:Vt,labelpos:Mt,labelType:Ut,thickness:jt,classes:Ht,look:d};i.push(T),M++}break}})},"setupDoc"),$t=f((t,e=Yt)=>{let s=e;if(t.doc)for(const a of t.doc)a.stmt==="dir"&&(s=a.value);return s},"getDir");function et(t,e,s){if(!e.id||e.id==="</join></fork>"||e.id==="</choice>")return;e.cssClasses&&(Array.isArray(e.cssCompiledStyles)||(e.cssCompiledStyles=[]),e.cssClasses.split(" ").forEach(i=>{const l=s.get(i);l&&(e.cssCompiledStyles=[...e.cssCompiledStyles??[],...l.styles])}));const a=t.find(i=>i.id===e.id);a?Object.assign(a,e):t.push(e)}f(et,"insertOrUpdateNode");function Xt(t){var e;return((e=t==null?void 0:t.classes)==null?void 0:e.join(" "))??""}f(Xt,"getClassesFromDbInfo");function Jt(t){return(t==null?void 0:t.styles)??[]}f(Jt,"getStylesFromDbInfo");var st=f((t,e,s,a,i,l,d,S)=>{var A,$,x;const p=e.id,T=s.get(p),_=Xt(T),m=Jt(T),k=F();if(b.info("dataFetcher parsedItem",e,T,m),p!=="root"){let I=Dt;e.start===!0?I=ye:e.start===!1&&(I=ge),e.type!==it&&(I=e.type),St.get(p)||St.set(p,{id:p,shape:I,description:W.sanitizeText(p,k),cssClasses:`${_} ${me}`,cssStyles:m});const u=St.get(p);e.description&&(Array.isArray(u.description)?(u.shape=kt,u.description.push(e.description)):(A=u.description)!=null&&A.length&&u.description.length>0?(u.shape=kt,u.description===p?u.description=[e.description]:u.description=[u.description,e.description]):(u.shape=Dt,u.description=e.description),u.description=W.sanitizeTextOrArray(u.description,k)),(($=u.description)==null?void 0:$.length)===1&&u.shape===kt&&(u.type==="group"?u.shape=Nt:u.shape=Dt),!u.type&&e.doc&&(b.info("Setting cluster for XCX",p,$t(e)),u.type="group",u.isGroup=!0,u.dir=$t(e),u.shape=e.type===Gt?Ot:Nt,u.cssClasses=`${u.cssClasses} ${Ae} ${l?Le:""}`);const L={labelStyle:"",shape:u.shape,label:u.description,cssClasses:u.cssClasses,cssCompiledStyles:[],cssStyles:u.cssStyles,id:p,dir:u.dir,domId:yt(p,M),type:u.type,isGroup:u.type==="group",padding:8,rx:10,ry:10,look:d};if(L.shape===Ot&&(L.label=""),t&&t.id!=="root"&&(b.trace("Setting node ",p," to be child of its parent ",t.id),L.parentId=t.id),L.centerLabel=!0,e.note){const O={labelStyle:"",shape:Te,label:e.note.text,cssClasses:ve,cssStyles:[],cssCompiledStyles:[],id:p+Ie+"-"+M,domId:yt(p,M,zt),type:u.type,isGroup:u.type==="group",padding:(x=k.flowchart)==null?void 0:x.padding,look:d,position:e.note.position},N=p+wt,G={labelStyle:"",shape:Ee,label:e.note.text,cssClasses:u.cssClasses,cssStyles:[],id:p+wt,domId:yt(p,M,Wt),type:"group",isGroup:!0,padding:16,look:d,position:e.note.position};M++,G.id=N,O.parentId=N,et(a,G,S),et(a,O,S),et(a,L,S);let P=p,B=O.id;e.note.position==="left of"&&(P=O.id,B=p),i.push({id:P+"-"+B,start:P,end:B,arrowhead:"none",arrowTypeEnd:"",style:Bt,labelStyle:"",classes:ke,arrowheadStyle:Vt,labelpos:Mt,labelType:Ut,thickness:jt,look:d})}else et(a,L,S)}e.doc&&(b.trace("Adding nodes children "),we(e,e.doc,s,a,i,!l,d,S))},"dataFetcher"),$e=f(()=>{St.clear(),M=0},"reset"),v={START_NODE:"[*]",START_TYPE:"start",END_NODE:"[*]",END_TYPE:"end",COLOR_KEYWORD:"color",FILL_KEYWORD:"fill",BG_FILL:"bgFill",STYLECLASS_SEP:","},Pt=f(()=>new Map,"newClassesList"),Ft=f(()=>({relations:[],states:new Map,documents:{}}),"newDoc"),pt=f(t=>JSON.parse(JSON.stringify(t)),"clone"),z,Me=(z=class{constructor(e){this.version=e,this.nodes=[],this.edges=[],this.rootDoc=[],this.classes=Pt(),this.documents={root:Ft()},this.currentDocument=this.documents.root,this.startEndCount=0,this.dividerCnt=0,this.links=new Map,this.getAccTitle=re,this.setAccTitle=ae,this.getAccDescription=ne,this.setAccDescription=oe,this.setDiagramTitle=le,this.getDiagramTitle=ce,this.clear(),this.setRootDoc=this.setRootDoc.bind(this),this.getDividerId=this.getDividerId.bind(this),this.setDirection=this.setDirection.bind(this),this.trimColon=this.trimColon.bind(this)}extract(e){this.clear(!0);for(const i of Array.isArray(e)?e:e.doc)switch(i.stmt){case Q:this.addState(i.id.trim(),i.type,i.doc,i.description,i.note);break;case Ct:this.addRelation(i.state1,i.state2,i.description);break;case fe:this.addStyleClass(i.id.trim(),i.classes);break;case pe:this.handleStyleDef(i);break;case Se:this.setCssClass(i.id.trim(),i.styleClass);break;case"click":this.addLink(i.id,i.url,i.tooltip);break}const s=this.getStates(),a=F();$e(),st(void 0,this.getRootDocV2(),s,this.nodes,this.edges,!0,a.look,this.classes);for(const i of this.nodes)if(Array.isArray(i.label)){if(i.description=i.label.slice(1),i.isGroup&&i.description.length>0)throw new Error(`Group nodes can only have label. Remove the additional description for node [${i.id}]`);i.label=i.label[0]}}handleStyleDef(e){const s=e.id.trim().split(","),a=e.styleClass.split(",");for(const i of s){let l=this.getState(i);if(!l){const d=i.trim();this.addState(d),l=this.getState(d)}l&&(l.styles=a.map(d=>{var S;return(S=d.replace(/;/g,""))==null?void 0:S.trim()}))}}setRootDoc(e){b.info("Setting root doc",e),this.rootDoc=e,this.version===1?this.extract(e):this.extract(this.getRootDocV2())}docTranslator(e,s,a){if(s.stmt===Ct){this.docTranslator(e,s.state1,!0),this.docTranslator(e,s.state2,!1);return}if(s.stmt===Q&&(s.id===v.START_NODE?(s.id=e.id+(a?"_start":"_end"),s.start=a):s.id=s.id.trim()),s.stmt!==q&&s.stmt!==Q||!s.doc)return;const i=[];let l=[];for(const d of s.doc)if(d.type===Gt){const S=pt(d);S.doc=pt(l),i.push(S),l=[]}else l.push(d);if(i.length>0&&l.length>0){const d={stmt:Q,id:he(),type:"divider",doc:pt(l)};i.push(pt(d)),s.doc=i}s.doc.forEach(d=>this.docTranslator(s,d,!0))}getRootDocV2(){return this.docTranslator({id:q,stmt:q},{id:q,stmt:q,doc:this.rootDoc},!0),{id:q,doc:this.rootDoc}}addState(e,s=it,a=void 0,i=void 0,l=void 0,d=void 0,S=void 0,p=void 0){const T=e==null?void 0:e.trim();if(!this.currentDocument.states.has(T))b.info("Adding state ",T,i),this.currentDocument.states.set(T,{stmt:Q,id:T,descriptions:[],type:s,doc:a,note:l,classes:[],styles:[],textStyles:[]});else{const _=this.currentDocument.states.get(T);if(!_)throw new Error(`State not found: ${T}`);_.doc||(_.doc=a),_.type||(_.type=s)}if(i&&(b.info("Setting state description",T,i),(Array.isArray(i)?i:[i]).forEach(m=>this.addDescription(T,m.trim()))),l){const _=this.currentDocument.states.get(T);if(!_)throw new Error(`State not found: ${T}`);_.note=l,_.note.text=W.sanitizeText(_.note.text,F())}d&&(b.info("Setting state classes",T,d),(Array.isArray(d)?d:[d]).forEach(m=>this.setCssClass(T,m.trim()))),S&&(b.info("Setting state styles",T,S),(Array.isArray(S)?S:[S]).forEach(m=>this.setStyle(T,m.trim()))),p&&(b.info("Setting state styles",T,S),(Array.isArray(p)?p:[p]).forEach(m=>this.setTextStyle(T,m.trim())))}clear(e){this.nodes=[],this.edges=[],this.documents={root:Ft()},this.currentDocument=this.documents.root,this.startEndCount=0,this.classes=Pt(),e||(this.links=new Map,ue())}getState(e){return this.currentDocument.states.get(e)}getStates(){return this.currentDocument.states}logDocuments(){b.info("Documents = ",this.documents)}getRelations(){return this.currentDocument.relations}addLink(e,s,a){this.links.set(e,{url:s,tooltip:a}),b.warn("Adding link",e,s,a)}getLinks(){return this.links}startIdIfNeeded(e=""){return e===v.START_NODE?(this.startEndCount++,`${v.START_TYPE}${this.startEndCount}`):e}startTypeIfNeeded(e="",s=it){return e===v.START_NODE?v.START_TYPE:s}endIdIfNeeded(e=""){return e===v.END_NODE?(this.startEndCount++,`${v.END_TYPE}${this.startEndCount}`):e}endTypeIfNeeded(e="",s=it){return e===v.END_NODE?v.END_TYPE:s}addRelationObjs(e,s,a=""){const i=this.startIdIfNeeded(e.id.trim()),l=this.startTypeIfNeeded(e.id.trim(),e.type),d=this.startIdIfNeeded(s.id.trim()),S=this.startTypeIfNeeded(s.id.trim(),s.type);this.addState(i,l,e.doc,e.description,e.note,e.classes,e.styles,e.textStyles),this.addState(d,S,s.doc,s.description,s.note,s.classes,s.styles,s.textStyles),this.currentDocument.relations.push({id1:i,id2:d,relationTitle:W.sanitizeText(a,F())})}addRelation(e,s,a){if(typeof e=="object"&&typeof s=="object")this.addRelationObjs(e,s,a);else if(typeof e=="string"&&typeof s=="string"){const i=this.startIdIfNeeded(e.trim()),l=this.startTypeIfNeeded(e),d=this.endIdIfNeeded(s.trim()),S=this.endTypeIfNeeded(s);this.addState(i,l),this.addState(d,S),this.currentDocument.relations.push({id1:i,id2:d,relationTitle:a?W.sanitizeText(a,F()):void 0})}}addDescription(e,s){var l;const a=this.currentDocument.states.get(e),i=s.startsWith(":")?s.replace(":","").trim():s;(l=a==null?void 0:a.descriptions)==null||l.push(W.sanitizeText(i,F()))}cleanupLabel(e){return e.startsWith(":")?e.slice(2).trim():e.trim()}getDividerId(){return this.dividerCnt++,`divider-id-${this.dividerCnt}`}addStyleClass(e,s=""){this.classes.has(e)||this.classes.set(e,{id:e,styles:[],textStyles:[]});const a=this.classes.get(e);s&&a&&s.split(v.STYLECLASS_SEP).forEach(i=>{const l=i.replace(/([^;]*);/,"$1").trim();if(RegExp(v.COLOR_KEYWORD).exec(i)){const S=l.replace(v.FILL_KEYWORD,v.BG_FILL).replace(v.COLOR_KEYWORD,v.FILL_KEYWORD);a.textStyles.push(S)}a.styles.push(l)})}getClasses(){return this.classes}setCssClass(e,s){e.split(",").forEach(a=>{var l;let i=this.getState(a);if(!i){const d=a.trim();this.addState(d),i=this.getState(d)}(l=i==null?void 0:i.classes)==null||l.push(s)})}setStyle(e,s){var a,i;(i=(a=this.getState(e))==null?void 0:a.styles)==null||i.push(s)}setTextStyle(e,s){var a,i;(i=(a=this.getState(e))==null?void 0:a.textStyles)==null||i.push(s)}getDirectionStatement(){return this.rootDoc.find(e=>e.stmt===It)}getDirection(){var e;return((e=this.getDirectionStatement())==null?void 0:e.value)??de}setDirection(e){const s=this.getDirectionStatement();s?s.value=e:this.rootDoc.unshift({stmt:It,value:e})}trimColon(e){return e.startsWith(":")?e.slice(1).trim():e.trim()}getData(){const e=F();return{nodes:this.nodes,edges:this.edges,other:{},config:e,direction:Kt(this.getRootDocV2())}}getConfig(){return F().state}},f(z,"StateDB"),z.relationType={AGGREGATION:0,EXTENSION:1,COMPOSITION:2,DEPENDENCY:3},z),Pe=f(t=>`
defs #statediagram-barbEnd {
    fill: ${t.transitionColor};
    stroke: ${t.transitionColor};
  }
g.stateGroup text {
  fill: ${t.nodeBorder};
  stroke: none;
  font-size: 10px;
}
g.stateGroup text {
  fill: ${t.textColor};
  stroke: none;
  font-size: 10px;

}
g.stateGroup .state-title {
  font-weight: bolder;
  fill: ${t.stateLabelColor};
}

g.stateGroup rect {
  fill: ${t.mainBkg};
  stroke: ${t.nodeBorder};
}

g.stateGroup line {
  stroke: ${t.lineColor};
  stroke-width: 1;
}

.transition {
  stroke: ${t.transitionColor};
  stroke-width: 1;
  fill: none;
}

.stateGroup .composit {
  fill: ${t.background};
  border-bottom: 1px
}

.stateGroup .alt-composit {
  fill: #e0e0e0;
  border-bottom: 1px
}

.state-note {
  stroke: ${t.noteBorderColor};
  fill: ${t.noteBkgColor};

  text {
    fill: ${t.noteTextColor};
    stroke: none;
    font-size: 10px;
  }
}

.stateLabel .box {
  stroke: none;
  stroke-width: 0;
  fill: ${t.mainBkg};
  opacity: 0.5;
}

.edgeLabel .label rect {
  fill: ${t.labelBackgroundColor};
  opacity: 0.5;
}
.edgeLabel {
  background-color: ${t.edgeLabelBackground};
  p {
    background-color: ${t.edgeLabelBackground};
  }
  rect {
    opacity: 0.5;
    background-color: ${t.edgeLabelBackground};
    fill: ${t.edgeLabelBackground};
  }
  text-align: center;
}
.edgeLabel .label text {
  fill: ${t.transitionLabelColor||t.tertiaryTextColor};
}
.label div .edgeLabel {
  color: ${t.transitionLabelColor||t.tertiaryTextColor};
}

.stateLabel text {
  fill: ${t.stateLabelColor};
  font-size: 10px;
  font-weight: bold;
}

.node circle.state-start {
  fill: ${t.specialStateColor};
  stroke: ${t.specialStateColor};
}

.node .fork-join {
  fill: ${t.specialStateColor};
  stroke: ${t.specialStateColor};
}

.node circle.state-end {
  fill: ${t.innerEndBackground};
  stroke: ${t.background};
  stroke-width: 1.5
}
.end-state-inner {
  fill: ${t.compositeBackground||t.background};
  // stroke: ${t.background};
  stroke-width: 1.5
}

.node rect {
  fill: ${t.stateBkg||t.mainBkg};
  stroke: ${t.stateBorder||t.nodeBorder};
  stroke-width: 1px;
}
.node polygon {
  fill: ${t.mainBkg};
  stroke: ${t.stateBorder||t.nodeBorder};;
  stroke-width: 1px;
}
#statediagram-barbEnd {
  fill: ${t.lineColor};
}

.statediagram-cluster rect {
  fill: ${t.compositeTitleBackground};
  stroke: ${t.stateBorder||t.nodeBorder};
  stroke-width: 1px;
}

.cluster-label, .nodeLabel {
  color: ${t.stateLabelColor};
  // line-height: 1;
}

.statediagram-cluster rect.outer {
  rx: 5px;
  ry: 5px;
}
.statediagram-state .divider {
  stroke: ${t.stateBorder||t.nodeBorder};
}

.statediagram-state .title-state {
  rx: 5px;
  ry: 5px;
}
.statediagram-cluster.statediagram-cluster .inner {
  fill: ${t.compositeBackground||t.background};
}
.statediagram-cluster.statediagram-cluster-alt .inner {
  fill: ${t.altBackground?t.altBackground:"#efefef"};
}

.statediagram-cluster .inner {
  rx:0;
  ry:0;
}

.statediagram-state rect.basic {
  rx: 5px;
  ry: 5px;
}
.statediagram-state rect.divider {
  stroke-dasharray: 10,10;
  fill: ${t.altBackground?t.altBackground:"#efefef"};
}

.note-edge {
  stroke-dasharray: 5;
}

.statediagram-note rect {
  fill: ${t.noteBkgColor};
  stroke: ${t.noteBorderColor};
  stroke-width: 1px;
  rx: 0;
  ry: 0;
}
.statediagram-note rect {
  fill: ${t.noteBkgColor};
  stroke: ${t.noteBorderColor};
  stroke-width: 1px;
  rx: 0;
  ry: 0;
}

.statediagram-note text {
  fill: ${t.noteTextColor};
}

.statediagram-note .nodeLabel {
  color: ${t.noteTextColor};
}
.statediagram .edgeLabel {
  color: red; // ${t.noteTextColor};
}

#dependencyStart, #dependencyEnd {
  fill: ${t.lineColor};
  stroke: ${t.lineColor};
  stroke-width: 1;
}

.statediagramTitleText {
  text-anchor: middle;
  font-size: 18px;
  fill: ${t.textColor};
}
`,"getStyles"),Ue=Pe;export{Me as S,Be as a,Ve as b,Ue as s};
//# sourceMappingURL=chunk-TVAH2DTR.js.map
