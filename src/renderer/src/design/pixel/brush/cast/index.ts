// El elenco dibujado a mano: al importarse, cada muñeco queda registrado para su personaje.
import { registerRig } from '../rigs'
import { CAST_A } from './a'
import { CAST_B } from './b'
import { CAST_C } from './c'

registerRig(...CAST_A, ...CAST_B, ...CAST_C)
