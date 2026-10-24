// Cultivar/engineering DESIGN ASSUMPTIONS; not agronomic yield predictions.
const rows = [
  ['lettuce', '奶油生菜', '叶菜', 24, 3, 16, 200, 1.4, 5.8, '#8bc65c', 'rosette'],
  ['pakchoi', '小白菜', '叶菜', 28, 3.5, 16, 220, 1.8, 6.0, '#458e4f', 'white-stem'],
  ['basil', '罗勒', '香草', 30, 2, 16, 250, 1.6, 6.0, '#4baf76', 'paired-leaf'],
  ['strawberry', '草莓', '果蔬', 60, 2, 16, 300, 1.8, 5.8, '#ed5b65', 'red-berry'],
  ['tomato', '矮生番茄', '果蔬', 70, 5, 18, 350, 2.6, 6.0, '#e55c3d', 'truss-fruit'],
  ['pepper', '甜椒', '果蔬', 75, 4, 18, 350, 2.4, 6.0, '#f2bf4b', 'lobed-fruit'],
  ['potato', '马铃薯', '主粮实验', 80, 4, 16, 300, 2.0, 5.8, '#bc9871', 'root-tuber'],
  ['wheat', '矮秆小麦', '主粮实验', 90, 1.2, 18, 400, 2.2, 6.2, '#dfbb58', 'grain-ear'],
  ['soybean', '矮生大豆', '主粮实验', 85, 1.5, 14, 350, 2.0, 6.0, '#91ac51', 'bean-pod'],
];
export const FARM_CROPS = Object.freeze(Object.fromEntries(rows.map(([id,name,group,days,kgPerM2,lightHours,ppfd,ec,ph,color,form]) => [id,Object.freeze({id,name,group,days,kgPerM2,lightHours,ppfd,ec,ph,color,form, durationSeconds:days*86400, dli:ppfd*lightHours*3600/1e6})])));
export const FARM_CROP_LIST = Object.freeze(Object.values(FARM_CROPS));
