// Public resident catalogue; open-source portraits are original SVG placeholders.
// Keep full character secrets and unimplemented quest/reward data out of this module.
import { appUrl } from './appUrl.js';

const catalog = [
  {
    "id": "npc-ali",
    "name": "阿栗",
    "role": "杂货铺店主",
    "species": "人类",
    "portrait": "/npc/ali.svg",
    "description": "街角杂货铺的店主，熟悉常用物资和镇内地址，也乐意帮新来者辨认各种物件。",
    "locationHint": "街角杂货铺",
    "dialogue": {
      "greeting": "欢迎，先不用急着买东西。你是在找一样物件，还是在找去某个地方的路？",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "我叫阿栗，管这间杂货铺。以前总想把东西排得一样齐，现在更在意你能不能自己找到。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "门边是常用物，柜台上是备货册。营业牌翻到哪一面都能留话，别担心跑空。"
        }
      ]
    }
  },
  {
    "id": "npc-huaya",
    "name": "花芽",
    "role": "花圃设计师",
    "species": "人类",
    "portrait": "/npc/huaya.svg",
    "description": "照料公共花圃，也负责设计小镇的花箱、休憩角落和节庆花艺。",
    "locationHint": "公共花圃与花园长凳",
    "dialogue": {
      "greeting": "你先站在这里看看，再坐到那边看看。花园从两个高度看，可是两张不同的画。",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "我是花芽，喜欢设计花园。最近正在学另一件事：让没有种花的地方也有用。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "三只矮花箱围着长凳，旁边是能推篮子过去的小径。喜欢安静的话，靠树影那边坐。"
        }
      ]
    }
  },
  {
    "id": "npc-nuannuan",
    "name": "暖暖",
    "role": "织补匠",
    "species": "人类",
    "portrait": "/npc/nuannuan.svg",
    "description": "经营织补间，修补布包和软装，也愿意陪不会针线的人完成第一件小作品。",
    "locationHint": "织补间与门前软垫长凳",
    "dialogue": {
      "greeting": "先摸摸这两块布，再选喜欢的那块。不用先知道所有针法，今天学一小步就够了。",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "我叫暖暖，修修补补，也教一点针线。以前总爱替别人做完，现在正在练习好好等一等。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "窗边可以选布，台上有圆头工具，门前那张长凳可以随便坐。旧物先放托盘里，我会问清楚再动它。"
        }
      ]
    }
  },
  {
    "id": "npc-beidong",
    "name": "北冬",
    "role": "山路维护员",
    "species": "人类",
    "portrait": "/npc/beidong.svg",
    "description": "维护山脚步道、方向牌与休息设施，熟悉长短两条路线。",
    "locationHint": "山脚缓坡步道与路亭",
    "dialogue": {
      "greeting": "上坡还是散步？两条路都能到，不想赶的话，我们先看看有树叶标记的这条。",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "北冬，维护山脚这几条路。以前只会告诉别人怎么快点到，现在也记得告诉别人在哪儿能歇脚。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "箭头是短路，树叶是缓坡路。路亭旁能借到路线卡，平台的长凳也不必等走累了才坐。"
        }
      ]
    }
  },
  {
    "id": "npc-juya",
    "name": "橘芽",
    "role": "花园小向导",
    "species": "会说短句的幻想橘猫伙伴",
    "portrait": "/npc/juya.svg",
    "description": "会说短句的橘猫，熟悉花园里容易忽略的小路和休息角落。",
    "locationHint": "公共花园与矮花箱之间",
    "dialogue": {
      "greeting": "跟我走？这次走大路。花盆缝，不算路。喵。",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "橘芽。这里的小向导。我知道三处好地方，也知道要先等同伴。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "入口能认路。长凳能放书。石台边，能坐。三个地方，都重要。"
        }
      ]
    }
  },
  {
    "id": "npc-lituan",
    "name": "栗团",
    "role": "木作铺零件管理员",
    "species": "会说短句的拟人化小熊猫",
    "portrait": "/npc/lituan.svg",
    "description": "栗团管理木作铺的零件柜，记得木块的形状，也给它们起奇怪的小名。它正把分类墙改成新手也能看懂的样子。",
    "locationHint": "木作铺零件墙与试装台",
    "dialogue": {
      "greeting": "来啦。找木块？还是，找木块的用处？",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "栗团。管小东西。小东西，也能撑稳大架子。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "上格圆孔，下格方口。看不懂？到矮桌来。摆一摆，就懂。"
        }
      ]
    }
  },
  {
    "id": "npc-lanyue",
    "name": "蓝跃",
    "role": "小镇路线挑战组织者",
    "species": "人类虚构角色",
    "portrait": "/npc/lanyue.svg",
    "description": "蓝跃负责环镇路线和观察挑战，既喜欢奔跑，也欢迎慢走。路线板会同时提供清晰的主路和替代路线。",
    "locationHint": "广场路线板与环镇步道",
    "dialogue": {
      "greeting": "欢迎到起点！先不出发，你今天想走得快一点，还是多看一点？",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "我叫蓝跃，负责把镇上的路变成小挑战。以前总问用了几秒，现在先问看见了什么。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "路线板上有三个观察点，实线是主路，带文字的虚线是平缓绕行路。两条路都能拿到完整盖章。"
        }
      ]
    }
  },
  {
    "id": "npc-maipao",
    "name": "麦跑",
    "role": "短途送货伙伴",
    "species": "会说短句的拟人化柯基",
    "portrait": "/npc/maipao.svg",
    "description": "麦跑熟悉近处的街巷，负责轻便小件。它总会先闻一闻包裹，再认真核对收件牌。",
    "locationHint": "杂货铺取货架与街巷交货点",
    "dialogue": {
      "greeting": "汪，搭档！先看牌。再出发。",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "麦跑。送轻件。鼻子记路，牌子认门。两个，都要。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "这个格，待送。那个格，签收。装不下？分两次。"
        }
      ]
    }
  },
  {
    "id": "npc-lanjian",
    "name": "蓝笺",
    "role": "信件与小镇档案管理员",
    "species": "人类虚构角色",
    "portrait": "/npc/lanjian.svg",
    "description": "蓝笺照看邮亭并整理小镇生活簿。她会核对信息、保留不同记法，也允许居民把不想公开的故事带回去。",
    "locationHint": "蓝窗邮亭与小镇档案室",
    "dialogue": {
      "greeting": "你好，我是蓝笺。想寄一封信，还是给小镇留一段你愿意公开的故事？",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "我整理信件和生活簿。不过写下来之前，我先问来源，也问当事人愿不愿意被看见。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "左边是可以公开翻阅的生活簿，中间是待核对区，右边封好的私人信件不能拆阅。空着的格子也有它的用途。"
        }
      ]
    }
  },
  {
    "id": "npc-chengsu",
    "name": "橙酥",
    "role": "面包铺主理人",
    "species": "人类虚构角色",
    "portrait": "/npc/chengsu.svg",
    "description": "橙酥经营面包铺，喜欢研究口感，也认真收集不喜欢的理由。她准备把开镇节取餐台做得清楚、好选、不催人。",
    "locationHint": "面包铺取餐台与公共试吃桌",
    "dialogue": {
      "greeting": "欢迎！今天先选口感，不着急选名字。我起名字可比烤面包慢多了。",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "我叫橙酥，在这里做面包，也练习听不同的意见。烤得好不等于人人都得喜欢，这件事我学了好一阵。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "取餐台的每一篮都有名称、形状和说明，试吃桌留着一个空盘。那个空盘不是忘了摆，是给下一次主意的。"
        }
      ]
    }
  },
  {
    "id": "npc-rongrong",
    "name": "绒绒",
    "role": "安静阅读角看护员",
    "species": "会说短句的白兔",
    "portrait": "/npc/rongrong.svg",
    "description": "接管窗边阅读角的白兔，愿意帮来访者找一本书或一个安静座位。",
    "locationHint": "窗边阅读角",
    "dialogue": {
      "greeting": "坐一会儿？低书架的书可以自己拿。我是绒绒。",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "我替这里照看书，也在学着画书。嗯……先从一只耳朵不太一样的兔子画起。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "高架是图册，低架是居民的小故事。窗边第二张凳子不晃眼，你可以试试。"
        }
      ]
    }
  },
  {
    "id": "npc-yubai",
    "name": "予白",
    "role": "壁画创作者",
    "species": "人类角色",
    "portrait": "/npc/yubai.svg",
    "description": "在工作室试色、为开镇节筹备公共壁画的创作者；室内画布可以作为配色练习。",
    "locationHint": "予白工作室与街角试色墙",
    "dialogue": {
      "greeting": "欢迎。先别急着选最好看的颜色，试试今天最想用的那个。",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "我是予白，负责壁画，也负责提醒自己别把每条歪线都修直。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "这张画布适合试色，旁边是工具笔记。珊瑚红、青绿、金黄都可以反复换，样板不怕重来。"
        }
      ]
    }
  },
  {
    "id": "npc-miaomu",
    "name": "苗木",
    "role": "社区菜园管理员",
    "species": "人类角色",
    "portrait": "/npc/miaomu.svg",
    "description": "照看社区菜园、组织采收与分菜，做事认真但正在学习给不同形状的收成留位置。",
    "locationHint": "社区菜园与分菜台",
    "dialogue": {
      "greeting": "来得正好，先看这一垄。叶牌翻到篮子那面，就能收啦。",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "我叫苗木，照看菜园。以前只想种得整整齐齐，现在还想知道每一筐最后和谁吃了顿饭。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "圆篮牌是成熟区，小花牌是留种区。分菜台能清点、装篮，不熟的菜先让它继续长。"
        }
      ]
    }
  },
  {
    "id": "npc-dengcheng",
    "name": "灯橙",
    "role": "灯具修缮师",
    "species": "人类角色",
    "portrait": "/npc/dengcheng.svg",
    "description": "负责修缮灯具和调整暖光，让台阶清晰、窗口不晃眼，也保留小镇黄昏的气氛。",
    "locationHint": "暖灯铺与黄昏步道",
    "dialogue": {
      "greeting": "站这里会晃眼吗？我叫灯橙，正好需要一个新的观察位置。",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "我修灯，也学着少开一点灯。有时候不是不够亮，是光去了不该去的地方。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "这里有木灯罩、遮光片和模拟步道。你只装这些安全练习件，供电的部分交给我。"
        }
      ]
    }
  },
  {
    "id": "npc-xiaotai",
    "name": "小苔",
    "role": "自然观察记录员",
    "species": "人类角色",
    "portrait": "/npc/xiaotai.svg",
    "description": "在溪边与菜园记录自然变化，邀请大家观察而不是随意采摘，并愿意公开更正自己的发现。",
    "locationHint": "溪边观察站与菜园留种区",
    "dialogue": {
      "greeting": "我现在看到的是三条水线。你也来看看？先不用猜答案。",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "我叫小苔，记录小镇很小的变化。我的本子里有一栏“还不知道”，那一栏也很重要。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "溪边有固定观察点，桌上有相同线索的样本卡。看水线、树皮和落叶，不需要拔下一棵植物。"
        }
      ]
    }
  },
  {
    "id": "npc-alan",
    "name": "阿蓝",
    "role": "修理铺学徒兼参赛作品接待员",
    "species": "人类角色",
    "portrait": "/npc/alan.svg",
    "description": "修理铺学徒，正为将来的参赛作品入驻准备接待流程与练习展位；不代表已有真实作品接入。",
    "locationHint": "修理铺接待台与来访创作者展位",
    "dialogue": {
      "greeting": "你好，我是阿蓝！先看看介绍，想试就进去，看完还能从这边回小镇。",
      "topics": [
        {
          "id": "self",
          "label": "认识你",
          "text": "我在修理铺学手艺，也帮忙接待将来的创作者。热心是我的强项，先确认再答应是我正在练的。"
        },
        {
          "id": "place",
          "label": "这里有什么",
          "text": "这里是练习接待台和纸灯演示展位，不是真实参赛作品。将来谁来、带来什么，都由作者提供信息后再写上去。"
        }
      ]
    }
  }
];

export const NPCS = Object.freeze(catalog.map(npc => Object.freeze({
  ...npc,
  portrait: appUrl(npc.portrait),
  dialogue: Object.freeze({
    greeting: npc.dialogue.greeting,
    topics: Object.freeze(npc.dialogue.topics.map(topic => Object.freeze(topic))),
  }),
})));
export const NPC_MAP = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(NPCS.map(npc => [npc.id, npc]))));
