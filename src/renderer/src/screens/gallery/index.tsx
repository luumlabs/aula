// Galería del sistema de diseño (solo para desarrollo y capturas: window.__aula.navigate({ name: 'gallery' })).
import { Card, Companion, COMPANION_IDS, PixelSky, PixelMedal, PixelCheck, PixelFlame, Spinner, AulaMark, CourseIcon, Button, SegmentedTabs, ProgressBar, ProgressRing, Chip, pixelBurst, SectionTitle, Group, Row, Icon, BrushUnderline, InkRing, DrawnTile, DrawnBorder, InkStrike, InkCheck, InkBurst, PencilRays, InkArrow, CoverBand } from '@renderer/design'
import { ICON_IDS } from '@renderer/design/pixel/resolve'
import { useState } from 'react'
import { ActivityPreview } from '../chat/ActivityPreview'

export default function Gallery() {
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a')
  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto px-6 pt-1 pb-24 grid gap-4 grid-cols-12 content-start">
      <HandDrawn />
      <ActivityPreview />
      <Card className="col-span-12" padded="lg">
        <SectionTitle title="Compañeros (trabajando)" />
        <div className="flex flex-wrap gap-3 mt-3">
          {COMPANION_IDS.map((id) => (
            <Companion key={id} id={id} size={44} working appear />
          ))}
        </div>
      </Card>
      <Card className="col-span-6" padded="lg">
        <SectionTitle title="Pixel" />
        <div className="flex items-end gap-5 mt-3">
          <PixelSky size={30} hour={10} />
          <PixelSky size={30} hour={23} />
          <PixelMedal size={44} />
          <PixelCheck size={28} />
          <PixelFlame size={28} />
          <Spinner size={18} />
          <AulaMark size={40} />
          <AulaMark size={40} state="working" />
          <AulaMark size={40} state="waiting" />
          <AulaMark size={40} state="offline" />
        </div>
        <div className="flex gap-2 mt-5">
          <Button variant="primary" onClick={(e) => pixelBurst(e.currentTarget)}>Primario</Button>
          <Button>Secundario</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="plain">Enlace</Button>
        </div>
        <div className="mt-4"><SegmentedTabs value={tab} onChange={setTab} items={[{ id: 'a', label: 'Resumen' }, { id: 'b', label: 'Aprender' }, { id: 'c', label: 'Practicar' }]} /></div>
        <div className="flex items-center gap-3 mt-4"><ProgressBar value={0.6} className="w-40" /><ProgressRing value={0.7} /><Chip>Filtro</Chip><Chip active>Elegido</Chip></div>
      </Card>
      <Card className="col-span-6" padded="lg">
        <SectionTitle title="Lista" />
        <Group className="mt-3">
          <Row index={0} leading={<Icon name="learn" size={17} />} title="Aprende: La parábola" subtitle="Funciones cuadráticas · 11 min" trailing="11 min" chevron onClick={() => {}} />
          <Row index={1} leading={<Icon name="cards" size={17} />} title="Repasa 4 tarjetas" subtitle="Química" trailing="3 min" chevron onClick={() => {}} />
          <Row index={2} leading={<Icon name="exam" size={17} />} title="Simulacro" subtitle="Inglés B2" trailing="40 min" chevron onClick={() => {}} />
        </Group>
      </Card>
      <Card className="col-span-12" padded="lg">
        <SectionTitle title="Iconos de curso" />
        <div className="flex flex-wrap gap-2 mt-3">
          {ICON_IDS.map((id, i) => <CourseIcon key={id} icon={id} hue={(i * 0.137) % 1} size={40} animation="dissolve" />)}
        </div>
      </Card>
    </div>
  )
}

/** El dibujo a mano (design/paint): todo junto, para revisarlo y para las tiras de fotogramas. */
function HandDrawn() {
  return (
    <Card className="col-span-12" padded="lg" data-gallery="hand-drawn">
      <SectionTitle title="Dibujo a mano" />
      <div className="mt-4 grid grid-cols-4 gap-6 items-center">
        <div className="relative grid place-items-center h-[150px] text-[var(--pigment-brick)]">
          <PencilRays seed="gallery-2" size={72} className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
          <AulaMark size={72} draw alive boil />
        </div>
        <div className="flex flex-col gap-5">
          <h3 className="t-title1"><BrushUnderline seed="gallery">Buenas tardes</BrushUnderline></h3>
          <div className="flex items-center gap-4 font-serif text-[17px]">
            <InkRing seed="gallery" size={32}>27</InkRing>
            <span className="flex items-center gap-2 t-callout"><InkCheck seed="gallery" size={20} className="relative!" /><InkStrike seed="gallery" color="var(--text3)">Repasa 6 tarjetas</InkStrike></span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <DrawnTile seed="gallery" size={72} radius={20} fill="color-mix(in oklab, #2E4D7B 16%, var(--paper))" ink="#26426C">
            <CourseIcon icon="trig" hue={0.6} size={48} />
          </DrawnTile>
          <span className="relative grid place-items-center w-14 h-14">
            <InkBurst seed="gallery" size={96} delay={600} className="-left-5 -top-5" />
            <PixelMedal size={40} />
          </span>
        </div>
        <div className="relative h-[130px] rounded-[22px] bg-surface" style={{ boxShadow: 'var(--e1)' }}>
          <DrawnBorder seed="gallery" radius={22} />
          <div className="relative isolate h-[64px] overflow-hidden rounded-t-[22px]">
            <CoverBand seed="gallery" fill="color-mix(in oklab, #3F7A5A 15%, var(--surface))" ink="#386E51" />
          </div>
          <InkArrow seed="gallery" w={96} h={64} from={{ x: 88, y: 6 }} to={{ x: 10, y: 44 }} delay={900} className="right-2 bottom-[-6px]" />
        </div>
      </div>
    </Card>
  )
}
