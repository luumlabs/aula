// Port de CanvasKitTests/ICSRealWorldTests.swift: calendarios con la forma que producen Canvas, Google Calendar,
// Outlook/Exchange y Apple Calendar (VTIMEZONE, líneas plegadas a 75 octetos partiendo caracteres UTF-8, alarmas…).
import { describe, expect, it } from 'vitest'
import { parseICS } from './parser'
import { localText, utcDate } from './testSupport.testutil'

const NY = 'America/New_York'
const now = utcDate('2026-10-07T15:00:00Z')

/** Pliega cada línea a 75 octetos (CRLF + espacio) como los generadores, sin respetar los caracteres UTF-8. */
function folded(text: string): Uint8Array {
  const out: number[] = []
  for (const raw of text.split('\n')) {
    const bytes = new TextEncoder().encode(raw)
    let i = 0
    let first = true
    do {
      const room = first ? 75 : 74
      const end = Math.min(bytes.length, i + room)
      if (!first) out.push(0x20)
      for (let k = i; k < end; k++) out.push(bytes[k])
      out.push(0x0d, 0x0a)
      i = end
      first = false
    } while (i < bytes.length)
  }
  return Uint8Array.from(out)
}

const parse = (text: string) => parseICS(folded(text), { now, timeZone: NY })

const canvasFeed = String.raw`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Instructure//Canvas//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Sample Student
X-WR-CALDESC:Calendar feed for Sample Student
X-WR-TIMEZONE:America/New_York
BEGIN:VEVENT
DTSTAMP:20261001T150812Z
UID:event-assignment-8123456
DTSTART:20261009T140000Z
DTEND:20261009T140000Z
SUMMARY:Chapter 1-2 Exam [MATH112-12345]
DESCRIPTION:Click on the link to view the assignment\n\nhttps://school.instructure.com/courses/1234567/assignments/8123456
URL;VALUE=URI:https://school.instructure.com/courses/1234567/assignments/8123456
CLASS:PUBLIC
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
DTSTAMP:20261001T150812Z
UID:event-assignment-8123457
DTSTART:20261012T035900Z
DTEND:20261012T035900Z
SUMMARY:Quiz 5 - Sections 3.1 to 3.3 [MATH112-12345]
DESCRIPTION:Click on the link to view the assignment\n\nhttps://school.instructure.com/courses/1234567/assignments/8123457
URL;VALUE=URI:https://school.instructure.com/courses/1234567/assignments/8123457
END:VEVENT
BEGIN:VEVENT
DTSTAMP:20261001T150812Z
UID:event-assignment-8123458
DTSTART:20261014T035900Z
DTEND:20261014T035900Z
SUMMARY:Essay 2: Rhetorical analysis [ENG1101-777]
DESCRIPTION:Write a 3-page essay.\nUse MLA format\, double-spaced.\n\nhttps://school.instructure.com/courses/7654321/assignments/8123458
URL;VALUE=URI:https://school.instructure.com/courses/7654321/assignments/8123458
X-ALT-DESC;FMTTYPE=text/html:<p>Write a 3-page essay.<br>Use MLA format, double-spaced.</p>
END:VEVENT
BEGIN:VEVENT
DTSTAMP:20261001T150812Z
UID:event-calendar-event-4551
DTSTART;VALUE=DATE:20261019
DTEND;VALUE=DATE:20261020
SUMMARY:Fall Break - No classes [ENG1101-777]
END:VEVENT
BEGIN:VEVENT
DTSTAMP:20261001T150812Z
UID:event-calendar-event-4552
DTSTART:20261009T180000Z
DTEND:20261009T190000Z
SUMMARY:Office hours [MATH112-12345]
LOCATION:Building C\, Room 204
DESCRIPTION:Come with questions about Chapter 4.
END:VEVENT
BEGIN:VEVENT
DTSTAMP:20261001T150812Z
UID:event-assignment-override-99
DTSTART:20261021T035900Z
DTEND:20261021T035900Z
SUMMARY:Midterm Review Packet [MATH112-12345]
END:VEVENT
END:VCALENDAR`

const googleExport = String.raw`BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Sample Student
X-WR-TIMEZONE:America/New_York
BEGIN:VTIMEZONE
TZID:America/New_York
X-LIC-LOCATION:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20261005T080000
DTEND;TZID=America/New_York:20261005T085000
RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20261207T045959Z;BYDAY=MO,WE,FR
EXDATE;TZID=America/New_York:20261009T080000
DTSTAMP:20261007T120000Z
UID:3k1v9f0@google.com
CREATED:20260820T150000Z
DESCRIPTION:Bring a calculator.\nChapter 4 starts today.
LAST-MODIFIED:20260901T150000Z
LOCATION:Main Campus\, Building C
SEQUENCE:0
STATUS:CONFIRMED
SUMMARY:MATH112 Trigonometry
TRANSP:OPAQUE
BEGIN:VALARM
ACTION:DISPLAY
DESCRIPTION:This is an event reminder
TRIGGER:-P0DT0H30M0S
END:VALARM
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261009
DTEND;VALUE=DATE:20261010
DTSTAMP:20261007T120000Z
UID:allday-exam@google.com
SUMMARY:Midterm Exam!!
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20261023T170000
DTEND;TZID=America/New_York:20261023T180000
DTSTAMP:20261007T120000Z
UID:cancelled@google.com
STATUS:CANCELLED
SUMMARY:Study group (cancelled)
END:VEVENT
BEGIN:VEVENT
DTSTART:20261011T230000Z
DTEND:20261012T000000Z
DTSTAMP:20261007T120000Z
UID:utc-event@google.com
SUMMARY:Review session for exam 2
DESCRIPTION:<p>Zoom: <a href="https://zoom.us/j/9999">https://zoom.us/j/9999</a></p>
END:VEVENT
END:VCALENDAR`

const outlookExport = String.raw`BEGIN:VCALENDAR
METHOD:PUBLISH
PRODID:Microsoft Exchange Server 2010
VERSION:2.0
X-WR-CALNAME:Calendario
BEGIN:VTIMEZONE
TZID:Eastern Standard Time
BEGIN:STANDARD
DTSTART:16010101T020000
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
CLASS:PUBLIC
CREATED:20260901T120000Z
DESCRIPTION:Final exam\, chapters 1-9.\nRoom 301.\n
DTEND;TZID=Eastern Standard Time:20261209T110000
DTSTAMP:20261007T120000Z
DTSTART;TZID=Eastern Standard Time:20261209T080000
LAST-MODIFIED:20260901T120000Z
LOCATION:Room 301
PRIORITY:5
SEQUENCE:0
SUMMARY;LANGUAGE=en-us:Final Exam - Calculus I
TRANSP:OPAQUE
UID:040000008200E00074C5B7101A82E00800000000A0B1C2D3E4F5
X-ALT-DESC;FMTTYPE=text/html:<html><body><p>Final exam\, <b>chapters 1-9</b>.</p><ul><li>Bring ID</li><li>No phones</li></ul></body></html>
X-MICROSOFT-CDO-BUSYSTATUS:BUSY
X-MICROSOFT-CDO-IMPORTANCE:1
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=Pacific Standard Time:20261209T080000
DTEND;TZID=Pacific Standard Time:20261209T090000
SUMMARY:Call with Seattle team
UID:pacific-1
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261224
DTEND;VALUE=DATE:20270102
SUMMARY:Winter break
UID:break-1
END:VEVENT
END:VCALENDAR`

const appleExport = String.raw`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//macOS 15.0//EN
CALSCALE:GREGORIAN
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
DTSTART:20070311T020000
TZNAME:EDT
TZOFFSETTO:-0400
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
CREATED:20261001T120000Z
DTEND;TZID=America/New_York:20261009T120000
DTSTAMP:20261007T120000Z
DTSTART;TZID=America/New_York:20261009T100000
LAST-MODIFIED:20261001T120000Z
LOCATION:Main Campus
SEQUENCE:1
SUMMARY:Parcial de Trigonometría
TRANSP:OPAQUE
UID:AB12CD34-0000-1111-2222-333344445555
X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC
X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="1 Main St\nSpringfield\, IL";X-APPLE-RADIUS=49.9:geo:39.8,-89.6
ATTENDEE;CN=Sample Student;CUTYPE=INDIVIDUAL;PARTSTAT=ACCEPTED:mailto:student@example.com
BEGIN:VALARM
ACTION:AUDIO
TRIGGER:-PT1H
X-WR-ALARMUID:11111111-2222-3333-4444-555555555555
END:VALARM
END:VEVENT
END:VCALENDAR`

describe('ICS · calendarios reales', () => {
  it('Canvas de principio a fin', () => {
    const events = parse(canvasFeed)
    expect(events.map((e) => e.title)).toEqual(['Chapter 1-2 Exam', 'Office hours', 'Quiz 5 - Sections 3.1 to 3.3', 'Essay 2: Rhetorical analysis', 'Fall Break - No classes', 'Midterm Review Packet'])
    expect(events.map((e) => localText(e.start))).toEqual(['2026-10-09 10:00', '2026-10-09 14:00', '2026-10-11 23:59', '2026-10-13 23:59', '2026-10-19 00:00', '2026-10-20 23:59'])
    expect(events.map((e) => e.kind)).toEqual(['exam', 'event', 'quiz', 'assignment', 'event', 'assignment'])
    expect(events.map((e) => e.isExam)).toEqual([true, false, true, false, false, false])
    expect(events.map((e) => e.course)).toEqual(['MATH112', 'MATH112', 'MATH112', 'ENG1101', 'ENG1101', 'MATH112'])
    expect(events[0].url).toBe('https://school.instructure.com/courses/1234567/assignments/8123456')
    expect(events[1].location).toBe('Building C, Room 204')
    expect(events[4].allDay).toBe(true)
    expect(events[3].descriptionText?.startsWith('Write a 3-page essay.\nUse MLA format, double-spaced.')).toBe(true)
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length)
    expect(events.every((e) => e.source === 'ics')).toBe(true)
  })

  it('Canvas con Unicode partido por los pliegues', () => {
    const title = 'Examen parcial número 2: círculo unidad, identidades trigonométricas y gráficas ñandú 📐📊 [MATH112-12345]'
    const e = parse(`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:event-assignment-1\nDTSTART:20261009T140000Z\nSUMMARY:${title}\nEND:VEVENT\nEND:VCALENDAR`)
    expect(e).toHaveLength(1)
    expect(e[0].title).toBe('Examen parcial número 2: círculo unidad, identidades trigonométricas y gráficas ñandú 📐📊')
    expect(e[0].course).toBe('MATH112')
    expect(e[0].kind).toBe('exam')
  })

  it('Google Calendar de principio a fin', () => {
    const events = parse(googleExport)
    const classes = events.filter((e) => e.title === 'MATH112 Trigonometry')
    expect(classes).toHaveLength(26)
    expect(localText(classes[0].start)).toBe('2026-10-05 08:00')
    expect(classes.some((e) => localText(e.start).startsWith('2026-10-09'))).toBe(false)
    expect(localText(classes[classes.length - 1].start)).toBe('2026-12-04 08:00')
    expect(classes.every((e) => localText(e.start).endsWith('08:00'))).toBe(true)
    expect(classes[0].location).toBe('Main Campus, Building C')
    expect(classes[0].descriptionText).toBe('Bring a calculator.\nChapter 4 starts today.')
    expect(classes[0].end!.getTime() - classes[0].start.getTime()).toBe(3_000_000)
    expect(classes[0].kind).toBe('event')
    const midterm = events.find((e) => e.title === 'Midterm Exam!!')!
    expect(midterm.allDay).toBe(true)
    expect(midterm.kind).toBe('exam')
    expect(localText(midterm.start)).toBe('2026-10-09 00:00')
    expect(events.find((e) => e.title.includes('Study group'))).toBeUndefined()
    const review = events.find((e) => e.title === 'Review session for exam 2')!
    expect(review.isExam).toBe(false)
    expect(review.descriptionText).toBe('Zoom: https://zoom.us/j/9999')
    expect(review.start).toEqual(utcDate('2026-10-11T23:00:00Z'))
  })

  it('Outlook / Exchange de principio a fin', () => {
    const events = parse(outlookExport)
    expect(events.map((e) => e.title)).toEqual(['Final Exam - Calculus I', 'Call with Seattle team', 'Winter break'])
    const exam = events[0]
    expect(exam.kind).toBe('exam')
    expect(exam.isExam).toBe(true)
    expect(localText(exam.start)).toBe('2026-12-09 08:00')
    expect(localText(exam.end)).toBe('2026-12-09 11:00')
    expect(exam.location).toBe('Room 301')
    expect(exam.descriptionText).toBe('Final exam, chapters 1-9.\nRoom 301.')
    expect(events[1].start).toEqual(utcDate('2026-12-09T16:00:00Z'))
    expect(events[2].allDay).toBe(true)
    expect(localText(events[2].end)).toBe('2027-01-02 00:00')
  })

  it('Apple Calendar de principio a fin', () => {
    const e = parse(appleExport)
    expect(e).toHaveLength(1)
    expect(e[0].title).toBe('Parcial de Trigonometría')
    expect(e[0].kind).toBe('exam')
    expect(e[0].location).toBe('Main Campus')
    expect(localText(e[0].start)).toBe('2026-10-09 10:00')
    expect(localText(e[0].end)).toBe('2026-10-09 12:00')
    expect(e[0].id).toBe('AB12CD34-0000-1111-2222-333344445555')
  })

  it('la misma entrega vista desde distintas zonas', () => {
    const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:event-assignment-5\nDTSTART:20261009T035900Z\nSUMMARY:Homework [MATH112-1]\nEND:VEVENT\nEND:VCALENDAR'
    const cases: [string, string][] = [['America/New_York', '2026-10-08 23:59'], ['America/Chicago', '2026-10-08 22:59'], ['America/Los_Angeles', '2026-10-08 20:59'],
      ['Europe/Madrid', '2026-10-09 05:59'], ['Asia/Tokyo', '2026-10-09 12:59'], ['UTC', '2026-10-09 03:59']]
    for (const [zone, expected] of cases) {
      const e = parseICS(ics, { now, timeZone: zone })
      expect(localText(e[0].start, zone), zone).toBe(expected)
      expect(e[0].start).toEqual(utcDate('2026-10-09T03:59:00Z'))
    }
  })

  it('la misma hora de pared en distintos TZID', () => {
    const start = (tz: string) => parseICS(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:z\nDTSTART;TZID=${tz}:20261009T100000\nSUMMARY:Examen\nEND:VEVENT\nEND:VCALENDAR`, { now, timeZone: NY })[0].start
    expect(start('America/New_York')).toEqual(utcDate('2026-10-09T14:00:00Z'))
    expect(start('America/Bogota')).toEqual(utcDate('2026-10-09T15:00:00Z'))
    expect(start('America/Mexico_City')).toEqual(utcDate('2026-10-09T16:00:00Z'))
    expect(start('Europe/Madrid')).toEqual(utcDate('2026-10-09T08:00:00Z'))
    expect(start('Asia/Kolkata')).toEqual(utcDate('2026-10-09T04:30:00Z'))
    expect(start('Australia/Sydney')).toEqual(utcDate('2026-10-08T23:00:00Z'))
  })
})
