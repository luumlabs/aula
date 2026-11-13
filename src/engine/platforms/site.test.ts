import { describe, expect, it } from 'vitest'
import { downgradesToHttp, moodleAliasRoot, moodleRootFromWwwroot, registrableSite, sameRegistrableSite } from './site'

const moodle = { kind: 'moodle' as const, baseURL: 'https://campus.uni.edu/' }
const cfg = (root: string): string => `<script>M.cfg = {"wwwroot":"${root.replace(/\//g, '\\/')}","sesskey":"Ab12Cd34Ef"};</script>`

describe('sitio registrable', () => {
  it('dos etiquetas, o tres bajo un sufijo de país típico', () => {
    expect(registrableSite('campus.uni.edu')).toBe('uni.edu')
    expect(registrableSite('Moodle.Uni.EDU.')).toBe('uni.edu')
    expect(registrableSite('vle.york.ac.uk')).toBe('york.ac.uk')
    expect(registrableSite('campus.unam.edu.mx')).toBe('unam.edu.mx')
    expect(registrableSite('aulavirtual.uv.es')).toBe('uv.es')
    expect(registrableSite('ev.uni.com.ar')).toBe('uni.com.ar')
    expect(registrableSite('moodle.u-tokyo.ac.jp')).toBe('u-tokyo.ac.jp')
    expect(registrableSite('aula.sena.gov.co')).toBe('sena.gov.co')
  })

  it('sufijos más largos (estados) y alojamientos compartidos', () => {
    expect(registrableSite('moodle.district.k12.ca.us')).toBe('district.k12.ca.us')
    expect(registrableSite('www.city.ca.us')).toBe('city.ca.us')
    expect(registrableSite('moodle.school1.nsw.edu.au')).toBe('school1.nsw.edu.au')
    expect(registrableSite('moodle.uni.edu.au')).toBe('uni.edu.au')
    // cada cliente de un alojamiento compartido es su propio sitio
    expect(registrableSite('colegio1.moodlecloud.com')).toBe('colegio1.moodlecloud.com')
    expect(registrableSite('a.s3.amazonaws.com')).toBe('a.s3.amazonaws.com')
  })

  it('un sufijo público no es un sitio; una IP es solo ella; localhost también', () => {
    expect(registrableSite('ac.uk')).toBeNull()
    expect(registrableSite('edu.mx')).toBeNull()
    expect(registrableSite('nsw.edu.au')).toBeNull()
    expect(registrableSite('k12.ca.us')).toBeNull()
    expect(registrableSite('')).toBeNull()
    expect(registrableSite('a..b.edu')).toBeNull()
    expect(registrableSite('10.0.0.7')).toBe('10.0.0.7')
    expect(registrableSite('localhost')).toBe('localhost')
    expect(registrableSite('campus.uni.localhost')).toBe('uni.localhost')
  })

  it('une hosts del mismo sitio y nada más', () => {
    expect(sameRegistrableSite('campus.uni.edu', 'ev.uni.edu')).toBe(true)
    expect(sameRegistrableSite('uni.edu', 'www.uni.edu')).toBe(true)
    expect(sameRegistrableSite('moodle.york.ac.uk', 'vle.york.ac.uk')).toBe(true)
    expect(sameRegistrableSite('https://campus.uni.edu/moodle/', 'ev.uni.edu')).toBe(true)
    expect(sameRegistrableSite('campus.uni.localhost', 'ev.uni.localhost')).toBe(true)
    expect(sameRegistrableSite('york.ac.uk', 'leeds.ac.uk')).toBe(false)
    expect(sameRegistrableSite('unam.edu.mx', 'ipn.edu.mx')).toBe(false)
    expect(sameRegistrableSite('school1.nsw.edu.au', 'school2.nsw.edu.au')).toBe(false)
    expect(sameRegistrableSite('a.k12.ca.us', 'b.k12.ca.us')).toBe(false)
    expect(sameRegistrableSite('colegio1.moodlecloud.com', 'colegio2.moodlecloud.com')).toBe(false)
    expect(sameRegistrableSite('campus.uni.edu', 'uni.edu.evil.com')).toBe(false)
    expect(sameRegistrableSite('campus.uni.edu', 'campus.uni.org')).toBe(false)
    expect(sameRegistrableSite('10.0.0.7', '10.0.0.7')).toBe(true)
    expect(sameRegistrableSite('10.0.0.7', '10.0.0.8')).toBe(false)
    expect(sameRegistrableSite('ac.uk', 'ac.uk')).toBe(false)
    expect(sameRegistrableSite('', 'uni.edu')).toBe(false)
  })

  it('dominios de país con sufijos geográficos (lodz.pl, tokyo.jp…): ante la duda no une', () => {
    expect(sameRegistrableSite('moodle.uni.lodz.pl', 'evil.lodz.pl')).toBe(false)
    expect(sameRegistrableSite('moodle.uni.lodz.pl', 'portal.uni.lodz.pl')).toBe(false)
    expect(sameRegistrableSite('moodle.uni.tokyo.jp', 'evil.tokyo.jp')).toBe(false)
    expect(sameRegistrableSite('a.chiyoda.tokyo.jp', 'b.chiyoda.tokyo.jp')).toBe(false)
    expect(sameRegistrableSite('elearning.uni.milano.it', 'x.milano.it')).toBe(false)
    expect(registrableSite('moodle.uni.lodz.pl')).toBe('moodle.uni.lodz.pl')
    // con una segunda etiqueta conocida, como siempre
    expect(sameRegistrableSite('moodle.uw.edu.pl', 'portal.uw.edu.pl')).toBe(true)
    expect(sameRegistrableSite('moodle.u-tokyo.ac.jp', 'portal.u-tokyo.ac.jp')).toBe(true)
    expect(sameRegistrableSite('moodle.uw.edu.pl', 'evil.edu.pl')).toBe(false)
  })

  it('sufijos propios de algunos países: provincias de Canadá, condados de Suecia, estados de Australia, gouv.fr', () => {
    expect(sameRegistrableSite('a.school.on.ca', 'b.on.ca')).toBe(false)
    expect(sameRegistrableSite('q.utoronto.ca', 'portal.utoronto.ca')).toBe(true)
    expect(sameRegistrableSite('a.x.ac.se', 'b.ac.se')).toBe(false)
    expect(sameRegistrableSite('studium.uu.se', 'www.uu.se')).toBe(true)
    expect(sameRegistrableSite('a.x.nsw.au', 'b.nsw.au')).toBe(false)
    expect(sameRegistrableSite('a.education.gouv.fr', 'evil.gouv.fr')).toBe(false)
    expect(sameRegistrableSite('moodle.univ-lyon1.fr', 'portal.univ-lyon1.fr')).toBe(true)
  })

  it('nunca une hosts de identidad (el SSO de la universidad no es la plataforma)', () => {
    for (const idp of ['login.uni.edu', 'sso.uni.edu', 'idp.uni.edu', 'adfs.uni.edu', 'cas.uni.edu', 'shibboleth.uni.edu']) {
      expect(sameRegistrableSite('campus.uni.edu', idp), idp).toBe(false)
      expect(sameRegistrableSite(idp, 'campus.uni.edu'), idp).toBe(false)
    }
    expect(sameRegistrableSite('login.microsoftonline.com', 'login.microsoftonline.com')).toBe(false)
  })
})

describe('raíz de Moodle a partir de wwwroot', () => {
  it('mismo host que la página, con su carpeta y sin barra final', () => {
    expect(moodleRootFromWwwroot('https://ev.uni.edu/moodle/', 'https://ev.uni.edu/moodle/my/')).toBe('https://ev.uni.edu/moodle')
    expect(moodleRootFromWwwroot('https://EV.uni.edu', 'https://ev.uni.edu/my/')).toBe('https://ev.uni.edu')
    expect(moodleRootFromWwwroot('http://ev.uni.localhost:8123', 'http://ev.uni.localhost:8123/my/')).toBe('http://ev.uni.localhost:8123')
  })

  it('nunca baja a http si la página llegó por https', () => {
    expect(moodleRootFromWwwroot('http://ev.uni.edu/moodle', 'https://ev.uni.edu/moodle/my/')).toBe('https://ev.uni.edu/moodle')
  })

  it('otro host, otro esquema o con usuario: no', () => {
    expect(moodleRootFromWwwroot('https://campus.uni.edu', 'https://ev.uni.edu/my/')).toBeNull()
    expect(moodleRootFromWwwroot('javascript:alert(1)', 'https://ev.uni.edu/my/')).toBeNull()
    expect(moodleRootFromWwwroot('https://u:p@ev.uni.edu', 'https://ev.uni.edu/my/')).toBeNull()
    expect(moodleRootFromWwwroot('no es una dirección', 'https://ev.uni.edu/my/')).toBeNull()
  })
})

describe('Moodle de la cuenta en otro host del mismo sitio', () => {
  it('lo reconoce por el wwwroot de la propia página', () => {
    expect(moodleAliasRoot(moodle, 'https://ev.uni.edu/my/', cfg('https://ev.uni.edu'))).toBe('https://ev.uni.edu')
    expect(moodleAliasRoot(moodle, 'https://www.uni.edu/moodle/login/index.php', cfg('https://www.uni.edu/moodle'))).toBe('https://www.uni.edu/moodle')
  })

  it('no: la propia cuenta, otro sitio, un host de identidad, sin wwwroot o con el wwwroot de otro host', () => {
    expect(moodleAliasRoot(moodle, 'https://campus.uni.edu/my/', cfg('https://campus.uni.edu'))).toBeNull()
    expect(moodleAliasRoot(moodle, 'https://ev.otra.edu/my/', cfg('https://ev.otra.edu'))).toBeNull()
    expect(moodleAliasRoot(moodle, 'https://login.uni.edu/my/', cfg('https://login.uni.edu'))).toBeNull()
    expect(moodleAliasRoot(moodle, 'https://ev.uni.edu/my/', '<html>sin configuración</html>')).toBeNull()
    expect(moodleAliasRoot(moodle, 'https://ev.uni.edu/my/', cfg('https://moodle.uni.edu'))).toBeNull()
    expect(moodleAliasRoot(moodle, 'https://ev.uni.edu/my/', null)).toBeNull()
  })

  it('nunca una raíz http para una cuenta https (sí entre dos http)', () => {
    expect(moodleAliasRoot(moodle, 'http://ev.uni.edu/my/', cfg('http://ev.uni.edu'))).toBeNull()
    const plain = { kind: 'moodle' as const, baseURL: 'http://campus.uni.edu/' }
    expect(moodleAliasRoot(plain, 'http://ev.uni.edu/my/', cfg('http://ev.uni.edu'))).toBe('http://ev.uni.edu')
    expect(downgradesToHttp('https://a.edu/', 'http://a.edu')).toBe(true)
    expect(downgradesToHttp('http://a.edu/', 'https://a.edu')).toBe(false)
    expect(downgradesToHttp('https://a.edu/', 'https://b.edu')).toBe(false)
  })

  it('solo para Moodle', () => {
    expect(moodleAliasRoot({ kind: 'canvas', baseURL: 'https://campus.uni.edu/' }, 'https://ev.uni.edu/', cfg('https://ev.uni.edu'))).toBeNull()
    expect(moodleAliasRoot({ kind: 'other', baseURL: 'https://campus.uni.edu/' }, 'https://ev.uni.edu/', cfg('https://ev.uni.edu'))).toBeNull()
  })
})
