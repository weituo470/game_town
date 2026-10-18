import {
  DISTRICTS, EMPTY_PLOTS, FOUNTAIN, STREETS, WORLD_BOUNDS, WORLD_LOCATIONS, WORLD_SIZE,
} from '../../shared/world.js';
import { GAMES } from '../lib/catalog.js';
import { OUTDOOR_GAMES } from '../minigames/outdoor.js';
import { RIVER, RIVER_PIER } from '../../shared/river.js';
import { WONDERS, WONDER_BRIDGES, WONDER_MAP } from '../../shared/wonders.js';
import { GPT_PARK, GPT_BRIDGE } from '../../shared/gpt-park.js';
import { DEEPSEEK_PARK, PARK_BRIDGES } from '../../shared/deepseek-park.js';
import './atlas.css';

const left = WONDER_MAP.centerX - WONDER_MAP.width / 2;
const top = WONDER_MAP.centerZ - WONDER_MAP.depth / 2;
const districtMarks = { north: '北', east: '东', south: '南', west: '西' };
const positionStyle = (x, z) => ({
  left: `${(x - left) / WONDER_MAP.width * 100}%`,
  top: `${(z - top) / WONDER_MAP.depth * 100}%`,
});

export default function TownAtlas({ onTravel, onOutdoorStart, onGptTour, onDeepSeekTour }) {
  return (
    <div className="town-atlas">
      {onOutdoorStart && <section className="atlas-destinations" aria-label="户外游乐导航"><h3>直接在小镇里玩</h3><div className="outdoor-atlas-links">{OUTDOOR_GAMES.map(game => <button key={game.id} onClick={() => onOutdoorStart(game.id)}><span>{game.place} · {game.name}</span><span>{game.global ? '操作说明' : '游玩 ↗'}</span></button>)}</div></section>}
      <p className="atlas-intro">
        主镇长宽各扩展 {WORLD_SIZE.scale} 倍，面积扩大至原来的 {WORLD_SIZE.scale ** 2} 倍。
        三处奇观、东北方 GPT 园区与西北方 DeepSeek 园区通过步桥相连。可步行、飞行探索，或选择下方入口直接前往。
      </p>

      <figure className="atlas-figure">
        <div className="atlas-drawing" style={{ aspectRatio: `${WONDER_MAP.width} / ${WONDER_MAP.depth}` }}>
          <svg
            className="atlas-svg"
            viewBox={`${left} ${top} ${WONDER_MAP.width} ${WONDER_MAP.depth}`}
            role="img"
            aria-label="小镇街道平面图，北方朝上。十字主街连接中央喷泉，环街连接四个新区。四座现有小游戏建筑用编号标记，虚线地块尚未建造。西侧虎鲸湾、东侧航母港、北侧发射场、东北方 GPT 主题园区与西北方 DeepSeek 蓝鲸岛用步桥相连。"
          >
            <title>游戏小镇街道与预留地块</title>
            <rect fill="#c1dcdf" x={left} y={top} width={WONDER_MAP.width} height={WONDER_MAP.depth} rx="3" />
            <rect className="atlas-ground" x={-WORLD_SIZE.width / 2} y={WORLD_SIZE.centerZ - WORLD_SIZE.depth / 2} width={WORLD_SIZE.width} height={WORLD_SIZE.depth} rx="3" />
            <rect x={RIVER.x-RIVER.width/2} y={RIVER.z-RIVER.depth/2} width={RIVER.width} height={RIVER.depth} fill="#71a8b3"/>
            <rect x={RIVER_PIER.x-RIVER_PIER.width/2} y={RIVER_PIER.z-RIVER_PIER.depth/2} width={RIVER_PIER.width} height={RIVER_PIER.depth} fill="#b79666"/>
            {WONDER_BRIDGES.map(rect => <rect key={rect.id} className="atlas-wonder-bridge" x={rect.x - rect.width / 2} y={rect.z - rect.depth / 2} width={rect.width} height={rect.depth}/>)}
            {WONDERS.map(rect => <rect key={rect.id} className="atlas-wonder-island" x={rect.x - rect.width / 2} y={rect.z - rect.depth / 2} width={rect.width} height={rect.depth} rx="2"/>)}
            <rect data-park-bridge={GPT_PARK.id} x={GPT_BRIDGE.x - GPT_BRIDGE.width / 2} y={GPT_BRIDGE.z - GPT_BRIDGE.depth / 2} width={GPT_BRIDGE.width} height={GPT_BRIDGE.depth} fill="#c4d8c7" />
            <rect data-theme-park={GPT_PARK.id} x={GPT_PARK.x - GPT_PARK.width / 2} y={GPT_PARK.z - GPT_PARK.depth / 2} width={GPT_PARK.width} height={GPT_PARK.depth} rx="2" fill={GPT_PARK.color} stroke="#24694e" strokeWidth=".6" />
            {PARK_BRIDGES.map((bridge, index) => <rect key={index} data-park-bridge={DEEPSEEK_PARK.id} x={bridge.x - bridge.width / 2} y={bridge.z - bridge.depth / 2} width={bridge.width} height={bridge.depth} fill="#9ab4d5" />)}
            <circle data-theme-park={DEEPSEEK_PARK.id} cx={DEEPSEEK_PARK.x} cy={DEEPSEEK_PARK.z} r={DEEPSEEK_PARK.width / 2} fill="#78a9e7" stroke="#285c96" strokeWidth=".6"/>

            <rect
              className="atlas-boundary"
              x={WORLD_BOUNDS.minX} y={WORLD_BOUNDS.minZ}
              width={WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX}
              height={WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ} rx="1.5"
            />
            {EMPTY_PLOTS.map(plot => (
              <rect key={plot.id} className="atlas-plot" data-plot={plot.id}
                x={plot.x - plot.width / 2} y={plot.z - plot.depth / 2}
                width={plot.width} height={plot.depth} rx=".8" />
            ))}
            {STREETS.map(street => (
              <rect key={street.id} className={`atlas-street atlas-street-${street.kind}`} data-street={street.id}
                x={street.x - street.width / 2} y={street.z - street.depth / 2}
                width={street.width} height={street.depth} rx=".5" />
            ))}
            <circle className="atlas-plaza" cx={FOUNTAIN.x} cy={FOUNTAIN.z} r={FOUNTAIN.plazaRadius} />
            <circle className="atlas-plaza-edge" cx={FOUNTAIN.x} cy={FOUNTAIN.z} r={FOUNTAIN.plazaRadius - .9} />
            <circle className="atlas-water-edge" cx={FOUNTAIN.x} cy={FOUNTAIN.z} r={FOUNTAIN.visualRadius + .55} />
            <circle className="atlas-water" cx={FOUNTAIN.x} cy={FOUNTAIN.z} r={FOUNTAIN.visualRadius} />
            <circle className="atlas-water-ring" cx={FOUNTAIN.x} cy={FOUNTAIN.z} r={FOUNTAIN.visualRadius * .62} />
            <circle className="atlas-water-center" cx={FOUNTAIN.x} cy={FOUNTAIN.z} r="1.25" />
            {WORLD_LOCATIONS.map(place => (
              <g key={place.id} data-building={place.id}>
                <rect className="atlas-building" x={place.x - 3.22} y={place.z - 2.8} width="6.44" height="5.6" rx=".7" />
                <path className="atlas-building-roof" d={`M ${place.x - 2.7} ${place.z - 2.2} L ${place.x} ${place.z - 3.5} L ${place.x + 2.7} ${place.z - 2.2}`} />
                <path className="atlas-building-door" d={`M ${place.doorX} ${place.z + 2.8} V ${place.doorZ + .7}`} />
              </g>
            ))}
          </svg>
          {/* HTML markers retain their readable CSS size as the SVG scales. */}
          <div className="atlas-markers" aria-hidden="true">
            <span className="atlas-direction" data-theme-park-marker={GPT_PARK.id} style={positionStyle(GPT_PARK.x, GPT_PARK.z)}>G</span>
            <span className="atlas-direction" data-theme-park-marker={DEEPSEEK_PARK.id} style={positionStyle(DEEPSEEK_PARK.x, DEEPSEEK_PARK.z)}>D</span>
            {DISTRICTS.map(district => (
              <span key={district.id} data-district-marker={district.id} className="atlas-direction" style={positionStyle(district.x, district.z)}>
                {districtMarks[district.id]}
              </span>
            ))}
            {GAMES.map((game, index) => (
              <span key={game.id} className="atlas-number" style={positionStyle(game.position[0], game.position[2])}>
                {index + 1}
              </span>
            ))}
          </div>
        </div>
        <figcaption className="atlas-caption">北方朝上 · 街道与建筑位置对应实际小镇</figcaption>
      </figure>

      <ul className="atlas-legend" aria-label="地图图例">
        <li><span className="atlas-key atlas-key-road" aria-hidden="true" />街道</li>
        <li><span className="atlas-key atlas-key-water" aria-hidden="true" />中央喷泉</li>
        <li><span className="atlas-key atlas-key-building" aria-hidden="true" />现有建筑</li>
        <li><span className="atlas-key atlas-key-plot" aria-hidden="true" />预留空地</li>
      </ul>
      <p className="atlas-note">虚线区域暂未建房，可自由穿行；后续小游戏将沿这些街道继续扩展。</p>
      <section className="atlas-destinations" aria-label="DeepSeek 园区导航">
        <h3>DeepSeek 主题园区 · 西北蓝鲸岛</h3>
        <p className="atlas-intro">{DEEPSEEK_PARK.subtitle}。从北街西端沿蓝色步桥到达，也可使用喷气背包飞过去。园区与小镇共享人物、昼夜和联机房间。</p>
        <button type="button" className="atlas-landmark" onClick={() => onTravel(DEEPSEEK_PARK.id)} aria-label={`前往${DEEPSEEK_PARK.name}`}><span>前往 DeepSeek 主题园区</span><span className="atlas-arrow" aria-hidden="true">↗</span></button>
        {onDeepSeekTour && <div className="atlas-district-links"><button type="button" onClick={onDeepSeekTour}>沉浸游览 DeepSeek 园区<span className="atlas-arrow" aria-hidden="true">↗</span></button></div>}
      </section>
      <section className="atlas-destinations" aria-label="主题园区导航">
        <h3>GPT 主题园区 · 东北新地标</h3>
        <p className="atlas-intro">{GPT_PARK.subtitle}。沿东林步道向北，穿过翡翠步桥，即可进入园区。</p>
        <button type="button" className="atlas-landmark" onClick={() => onTravel(GPT_PARK.id)} aria-label={`前往${GPT_PARK.name}`}>
          <span>前往 GPT 主题园区</span><span className="atlas-arrow" aria-hidden="true">↗</span>
        </button>
        {onGptTour && <div className="atlas-district-links"><button type="button" onClick={onGptTour} aria-label="沉浸游览 GPT 主题园区">沉浸游览<span className="atlas-arrow" aria-hidden="true">↗</span></button></div>}
      </section>
      <section className="atlas-destinations" aria-label="三大奇观导航"><h3>三大奇观 · 步桥相连</h3><div className="atlas-wonder-links">{WONDERS.map(w => <button type="button" key={w.id} onClick={() => onTravel(w.id)} aria-label={`前往${w.name}`}><strong>{w.name} ↗</strong><span>{w.subtitle}</span></button>)}</div></section>

      <section className="atlas-destinations" aria-label="街区导航">
        <h3>地标与街区</h3>
        <button type="button" className="atlas-landmark" onClick={() => onTravel('center')}>
          <span className="atlas-landmark-symbol" aria-hidden="true">
            <svg viewBox="0 0 28 28" width="28" height="28" fill="none">
              <path d="M14 3C11 7 7 11 7 15a7 7 0 0 0 14 0c0-4-4-8-7-12Z" stroke="currentColor" strokeWidth="1.7" />
              <path d="M4 24h20M11 16a3 3 0 0 0 3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </span>
          <span>前往中央喷泉</span>
          <span className="atlas-arrow" aria-hidden="true">↗</span>
        </button>
        <div className="atlas-district-links">
          {DISTRICTS.map(district => (
            <button key={district.id} type="button" onClick={() => onTravel(district.id)}>
              <span>{district.name}</span><span className="atlas-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      </section>

      <section className="atlas-destinations" aria-label="小游戏导航">
        <h3>已开放的小游戏</h3>
        <ol className="atlas-game-links">
          {GAMES.map((game, index) => (
            <li key={game.id}>
              <span className="atlas-list-number" aria-hidden="true">{index + 1}</span>
              <span className="atlas-game-label"><strong>{game.name}</strong><span>{game.category}</span></span>
              <button type="button" aria-label={`前往${game.name}`} onClick={() => onTravel(game.id)}>前往<span className="atlas-arrow" aria-hidden="true">↗</span></button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
