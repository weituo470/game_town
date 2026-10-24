import {AI_DRONE_V2_IDS,AI_DRONE_V2_KINDS,AI_DRONE_V2_LAYOUTS,AI_DRONE_V2_CAMERAS,AI_DRONE_V2_EFFECTS,AI_DRONE_V2_MOTIONS,AI_DRONE_V2_TRANSITIONS} from '../shared/aiDroneScoreV2.js';
const choices={id:AI_DRONE_V2_IDS,kind:AI_DRONE_V2_KINDS,layout:AI_DRONE_V2_LAYOUTS,camera:AI_DRONE_V2_CAMERAS,effect:AI_DRONE_V2_EFFECTS,motion:AI_DRONE_V2_MOTIONS,transition:AI_DRONE_V2_TRANSITIONS};
// One bounded re-composition for a plain enum mistake, never for executable,
// malformed, oversized, transport, truncation, quality or lifecycle failures.
export function aiDroneChoiceCorrection(value,error){
 const options=Object.hasOwn(choices,error?.field)?choices[error.field]:null;
 if(error?.code!=='AI_SCORE_CHOICE'||!options)return null;
 let values;
 if(Number.isInteger(error.sceneIndex)){
  const scene=value?.scenes?.[error.sceneIndex];
  values=['id','motion'].includes(error.field)?scene?.actors?.map(a=>a?.[error.field]):[scene?.[error.field]];
 }else values=value?.cast?.map(a=>a?.[error.field]);
 const invalid=values?.filter(v=>!options.includes(v));
 if(!invalid?.length||invalid.some(v=>typeof v!=='string'||!/^[A-Za-z][A-Za-z_-]{0,31}$/.test(v)||['constructor','prototype'].includes(v.toLowerCase())))return null;
 // No invalid value or raw provider output is sent back. Only trusted enums.
 return {role:'user',content:`上次草稿未通过引擎校验：${Number.isInteger(error.sceneIndex)?`第${error.sceneIndex+1}幕的`:'演员表的'}${error.field}使用了不支持的选项。请重新编排原命题，只能从 ${JSON.stringify(options)} 选择该字段，不能使用别名或大写。其他字段同样严格使用系统枚举。保持原主题的故事与高光，不照搬结构示例；这是本次请求唯一一次补编，请输出完整合规的version:2 JSON。`};
}
