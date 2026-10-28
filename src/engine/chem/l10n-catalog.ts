// Generado a partir del catálogo de la app Swift anterior. Ya no se regenera: este archivo es la fuente.
// Frases de ChemKit que ve el alumno (errores, correcciones), por idioma: clave = texto en español con los marcadores de
// Apple (%@, %lld, %1$@…); valor = traducción. Solo los idiomas de la interfaz de Aula (en español la clave es el texto,
// salvo las formas de plural).
// Para regenerarlo: extraer las claves de las llamadas `L('…')` de src/engine/chem y buscar cada una en el catálogo.
import type { ChemLanguage } from './element-l10n'

/** Una frase traducida o sus formas de plural («one», «other»…, como las variaciones de Apple). */
export type CatalogEntry = string | Readonly<Partial<Record<Intl.LDMLPluralRule, string>>>

export const MESSAGE_CATALOG: Partial<Record<ChemLanguage, Readonly<Record<string, CatalogEntry>>>> = {
  "es": {
    "En C₁V₁ = C₂V₂ tiene que faltar exactamente un dato (faltan %lld).": {
      one: "En C₁V₁ = C₂V₂ tiene que faltar exactamente un dato (falta %lld).",
      other: "En C₁V₁ = C₂V₂ tiene que faltar exactamente un dato (faltan %lld).",
    },
    "En PV = nRT tiene que faltar exactamente una magnitud (faltan %lld).": {
      one: "En PV = nRT tiene que faltar exactamente una magnitud (falta %lld).",
      other: "En PV = nRT tiene que faltar exactamente una magnitud (faltan %lld).",
    },
    "¡Correcto! El valor y las cifras significativas (%lld) están bien.": {
      one: "¡Correcto! El valor y la cifra significativa (%lld) está bien.",
      other: "¡Correcto! El valor y las cifras significativas (%lld) están bien.",
    },
  },
  "en": {
    "%@ está vacía.":
      "%@ is empty.",
    "%@ tiene que ser un volumen (me has dado %@).":
      "%1$@ has to be a volume (you gave me %2$@).",
    "%@ tiene que ser una presión (me has dado %@).":
      "%1$@ has to be a pressure (you gave me %2$@).",
    "%@ tiene que ser una temperatura (me has dado %@).":
      "%1$@ has to be a temperature (you gave me %2$@).",
    "(sin electrones)":
      "(no electrons)",
    "A «%@» le falta la unidad (g, mol, mL, atm, °C…).":
      "“%@” is missing its unit (g, mol, mL, atm, °C…).",
    "Alguna fórmula está escrita de otra forma, pero representa la misma sustancia.":
      "Some formula is written differently but represents the same substance.",
    "Con solo un volumen no puedo saber los moles: añade la concentración si es una disolución («25 mL 0.10 M») o, si es un gas, las condiciones («5.6 L CN» o «5.0 L a 25 °C y 1 atm»).":
      "With just one volume I can't know the moles: add the concentration if it's a solution (“25 mL 0.10 M”) or, if it's a gas, the conditions (“5.6 L CN” or “5.0 L at 25 °C and 1 atm”).",
    "Con un solo producto conocido basta: los demás se deducen de la ecuación.":
      "One known product is enough: the rest follow from the equation.",
    "Correcto: %@ tiene los mismos átomos que %@ (la has escrito de forma desarrollada).":
      "Correct: %1$@ has the same atoms as %2$@ (you wrote it in expanded form).",
    "Dame solo reactivos (para calcular lo que se forma) o solo un producto (para calcular lo que hace falta). Si tienes la cantidad obtenida, pásala como rendimiento real.":
      "Give me just the reactants (to calculate what forms) or just a product (to calculate what's missing). If you have the amount obtained, pass it along as the actual yield.",
    "Debería haber %lld %@ y tienes %lld.":
      "There should be %1$lld %2$@ atoms and you have %3$lld.",
    "Después de «^%@» tiene que ir el símbolo del isótopo (por ejemplo ^{14}C). Las cargas van al final: SO4^2-.":
      "After “^%@”, you need the isotope symbol (for example ^{14}C). Charges go at the end: SO4^2-.",
    "Dime la cantidad de al menos una especie (por ejemplo «Fe: 10 g»).":
      "Tell me the amount of at least one species (for example, \"Fe: 10 g\").",
    "El %@ es un producto, no un reactivo.":
      "%@ is a product, not a reactant.",
    "El %@ es un reactivo, no un producto.":
      "%@ is a reactant, not a product.",
    "El coeficiente debería ser %@.":
      "The coefficient should be %@.",
    "El coeficiente no puede ser 0.":
      "The coefficient can't be 0.",
    "El coeficiente tiene que ser positivo.":
      "The coefficient must be positive.",
    "El electrón no tiene número de oxidación.":
      "The electron has no oxidation number.",
    "El estado debería ser (%@), %@, no (%@).":
      "The state should be (%1$@), %2$@, not (%3$@).",
    "El nombre correcto es %@.":
      "The correct name is %@.",
    "El número «%@» es demasiado grande.":
      "The number \"%@\" is too large.",
    "El número «%@» está en un sitio raro: los subíndices van justo detrás del símbolo o del paréntesis.":
      "The number \"%@\" is in a strange spot: subscripts go right after the symbol or parenthesis.",
    "El pH tiene que ser un número.":
      "The pH has to be a number.",
    "El pOH tiene que ser un número.":
      "The pOH has to be a number.",
    "El punto de los hidratos («·») no puede ir dentro de un paréntesis.":
      "The hydrate dot (\"·\") can't be inside parentheses.",
    "El rendimiento real no puede ser negativo.":
      "The actual yield cannot be negative.",
    "El rendimiento teórico es 0.":
      "The theoretical yield is 0.",
    "El resultado es demasiado grande":
      "The result is too large",
    "El texto es demasiado largo (máximo %@ caracteres).":
      "The text is too long (maximum %@ characters).",
    "El valor es correcto, pero con los datos dados corresponden %lld cifras significativas, no %lld: escribe %@.":
      "The value is correct, but the given data call for %1$lld significant figures, not %2$lld: write %3$@.",
    "El valor es correcto, pero con los datos dados corresponden %lld cifras significativas, no entre %lld y %lld (ambiguo): escribe %@.":
      "The value is correct, but the given data call for %1$lld significant figures, not %2$lld–%3$lld (ambiguous): write %4$@.",
    "El valor no es correcto: debería salir %@ (%lld cifras significativas).":
      "The value isn't correct: it should be %1$@ (%2$lld significant figures).",
    "El valor no es correcto: debería salir ≈ %@.":
      "The value isn't correct: it should be ≈ %@.",
    "El volumen de disolución tiene que ser positivo.":
      "The volume of the solution must be positive.",
    "El volumen de disolución tiene que ser un volumen (me has dado %@).":
      "The volume of the solution must be a volume (you gave me %@).",
    "El volumen de la disolución tiene que ser positivo.":
      "The solution volume must be positive.",
    "El volumen de la disolución tiene que ser un volumen (me has dado %@).":
      "The solution volume must be a volume (you gave me %@).",
    "El volumen tiene que ser positivo.":
      "The volume must be positive.",
    "El volumen tiene que ser un volumen (me has dado %@).":
      "The volume must be a volume (you gave me %@).",
    "El «%@» se cierra con «%@»: usa el mismo tipo de paréntesis para abrir y cerrar.":
      "“%1$@” is closed with “%2$@”: use the same type of bracket to open and close.",
    "En %@ deberían ir %lld y has puesto %lld.":
      "In %1$@ there should be %2$lld, but you entered %3$lld.",
    "En C₁V₁ = C₂V₂ tiene que faltar exactamente un dato (faltan %lld).": {
      one: "In C₁V₁ = C₂V₂, exactly one value must be missing (%lld missing).",
      other: "In C₁V₁ = C₂V₂, exactly one value must be missing (%lld missing).",
    },
    "En PV = nRT tiene que faltar exactamente una magnitud (faltan %lld).": {
      one: "In PV = nRT, exactly one quantity must be missing (%lld missing).",
      other: "In PV = nRT, exactly one quantity must be missing (%lld missing).",
    },
    "En P₁V₁/T₁ = P₂V₂/T₂ tiene que faltar exactamente un dato.":
      "In P₁V₁/T₁ = P₂V₂/T₂ exactly one value must be missing.",
    "En la subcapa %@ caben como mucho %lld electrones, no %lld.":
      "The %1$@ subshell can hold at most %2$lld electrons, not %3$lld.",
    "En «%@»: %@":
      "In “%1$@”: %2$@",
    "Es un equilibrio: usa la doble flecha (⇌).":
      "It's a balance: use the double arrow (⇌).",
    "Escribe solo el resultado, sin operaciones: por ejemplo 0.0450 o 4.50e-2.":
      "Just type the result, without operations: for example 0.0450 or 4.50e-2.",
    "Escribe tu respuesta primero.":
      "Enter your answer first.",
    "Ese nombre corresponde a %@, no a %@.":
      "That name corresponds to %1$@, not %2$@.",
    "Esta reacción se escribe con una flecha simple (→).":
      "This reaction is written with a single arrow (→).",
    "Está balanceada, pero aquí se piden los coeficientes de la clave (por ejemplo, por mol de la sustancia que se forma): %@.":
      "It's balanced, but here the key asks for the coefficients (for example, per mole of the substance formed): %@.",
    "Está balanceada, pero con coeficientes fraccionarios; con enteros mínimos queda %@.":
      "It's balanced, but with fractional coefficients; with the lowest integers it's %@.",
    "Está balanceada, pero los coeficientes no son los mínimos: divídelos todos entre %@ → %@.":
      "It's balanced, but the coefficients aren't the lowest: divide them all by %1$@ → %2$@.",
    "Falta cerrar un corchete «%@».":
      "Missing closing \"%@\".",
    "Falta cerrar un paréntesis.":
      "Missing closing parenthesis.",
    "Falta el %@ (debería haber %lld).":
      "Missing %1$@ (there should be %2$lld).",
    "Falta el %@ en los productos.":
      "Missing %@ in the products.",
    "Falta el %@ en los reactivos.":
      "Missing %@ in the reactants.",
    "Falta la flecha (→) entre reactivos y productos.":
      "Missing arrow (→) between reactants and products.",
    "Falta la fórmula antes del «·».":
      "Missing formula before \"·\".",
    "Falta la fórmula después del «·».":
      "Missing formula after \"·\".",
    "Faltan datos para la dilución.":
      "Missing data for the dilution.",
    "Faltan datos para la ley combinada.":
      "Missing data for the combined gas law.",
    "Faltan datos para la ley de los gases.":
      "Missing data for the gas law.",
    "Faltan datos.":
      "Missing data.",
    "Faltan la temperatura y la presión del gas.":
      "Missing the temperature and pressure of the gas.",
    "Faltan los %@ de la ecuación.":
      "Missing the %@ of the equation.",
    "Faltan los productos de la ecuación.":
      "Missing the products of the equation.",
    "Faltan los reactivos de la ecuación.":
      "Missing the reactants of the equation.",
    "Has aplicado la regla de Madelung, pero este caso es una excepción (o es un ion, que pierde primero los electrones ns).":
      "You applied the Madelung rule, but this case is an exception (or it’s an ion, which loses the ns electrons first).",
    "Has escrito el nombre; se pide la fórmula: %@.":
      "You wrote the name; the formula is requested: %@.",
    "Has escrito la reacción al revés: los reactivos son %@ y los productos %@.":
      "You wrote the reaction backwards: the reactants are %1$@ and the products are %2$@.",
    "Has escrito un nombre (%@) y además no es la sustancia pedida.":
      "You wrote a name (%@), and it’s not the substance being asked for either.",
    "Has escrito una fórmula; se pide el nombre.":
      "You wrote a formula; the name is requested.",
    "Has escrito una fórmula; se pide el nombre: %@.":
      "You wrote a formula; the name is requested: %@.",
    "Hay %@ %@ a la izquierda y %@ a la derecha.":
      "There are %1$@ %2$@ on the left and %3$@ on the right.",
    "Hay demasiados paréntesis anidados (máximo %@ niveles).":
      "There are too many nested parentheses (a maximum of %@ levels).",
    "Hay un paréntesis vacío.":
      "There’s an empty pair of parentheses.",
    "Hay un «%@» en medio de la fórmula. La carga va al final (SO4^2-) y las especies se separan con « + » en las ecuaciones.":
      "There’s a “%@” in the middle of the formula. The charge goes at the end (SO4^2-) and species are separated by “ + ” in equations.",
    "Hay un «+» o «-» en medio de la fórmula «%@». La carga va al final (SO4^2-) y las especies se separan con « + » en las ecuaciones.":
      "There’s a “+” or “-” in the middle of the “%@” formula. The charge goes at the end (SO4^2-) and species are separated by “ + ” in equations.",
    "La cantidad de %@ tiene que ser positiva.":
      "The amount of %@ must be positive.",
    "La cantidad de %@ tiene que ser un número positivo.":
      "The amount of %@ must be a positive number.",
    "La cantidad de gas tiene que darse en moles o en gramos.":
      "The amount of gas must be given in moles or grams.",
    "La cantidad de gas tiene que ser positiva.":
      "The amount of gas must be positive.",
    "La cantidad de soluto tiene que ser positiva.":
      "The amount of solute must be positive.",
    "La cantidad de soluto tiene que ser una masa, unos moles o un número de partículas.":
      "The amount of solute must be a mass, a number of moles, or a number of particles.",
    "La carga debería ser %@.":
      "The charge should be %@.",
    "La carga total es %@ a la izquierda y %@ a la derecha: no se conserva.":
      "The total charge is %1$@ on the left and %2$@ on the right: it isn't conserved.",
    "La carga «%@» no está bien escrita: usa, por ejemplo, Fe3+, SO4^2- o NH4+.":
      "The charge \"%@\" isn't written correctly: use, for example, Fe3+, SO4^2-, or NH4+.",
    "La clave de este ejercicio no es un número válido.":
      "The key for this exercise isn't a valid number.",
    "La concentración de H₃O⁺ tiene que ser positiva.":
      "The H₃O⁺ concentration must be positive.",
    "La concentración tiene que ser positiva.":
      "The concentration must be positive.",
    "La concentración tiene que ser una molaridad (me has dado %@).":
      "The concentration needs to be a molarity (you gave me %@).",
    "La concentración y Ka tienen que ser positivas.":
      "The concentration and Ka need to be positive.",
    "La concentración y Kb tienen que ser positivas.":
      "The concentration and Kb need to be positive.",
    "La configuración electrónica está vacía.":
      "The electron configuration is empty.",
    "La correcta es %@.":
      "The correct one is %@.",
    "La descripción está vacía.":
      "The description is empty.",
    "La ecuación de referencia no se puede leer: %@":
      "The reference equation can’t be read: %@",
    "La ecuación está vacía.":
      "The equation is empty.",
    "La ecuación tiene más de una flecha: escribe una sola reacción.":
      "The equation has more than one arrow: enter a single reaction.",
    "La fórmula %@ está bien.":
      "The formula %@ is correct.",
    "La fórmula de referencia «%@» no se puede leer: %@":
      "The reference formula “%1$@” can’t be read: %2$@",
    "La fórmula empírica no tiene masa.":
      "The empirical formula has no mass.",
    "La fórmula está vacía.":
      "The formula is empty.",
    "La fórmula tiene cantidades demasiado grandes.":
      "The formula has amounts that are too large.",
    "La masa de disolución tiene que ser positiva.":
      "The mass of solution needs to be positive.",
    "La masa de disolución tiene que ser una masa (me has dado %@).":
      "The mass of solution needs to be a mass (you gave me %@).",
    "La masa de disolvente tiene que ser positiva.":
      "The mass of solvent needs to be positive.",
    "La masa de disolvente tiene que ser una masa (me has dado %@).":
      "The mass of solvent needs to be a mass (you gave me %@).",
    "La masa de soluto tiene que ser positiva.":
      "The mass of solute needs to be positive.",
    "La masa de soluto tiene que ser una masa (me has dado %@).":
      "The solute mass has to be a mass (you gave me %@).",
    "La masa molar (%@ g/mol) no es un múltiplo entero de la masa de %@ (%@ g/mol): n = %@. Revisa los datos.":
      "The molar mass (%1$@ g/mol) is not an integer multiple of the mass of %2$@ (%3$@ g/mol): n = %4$@. Check the data.",
    "La masa molar no encaja con la fórmula empírica %@: revisa los datos.":
      "The molar mass doesn't match the empirical formula %@: check the data.",
    "La masa molar tiene que ser un número positivo.":
      "The molar mass has to be a positive number.",
    "La presión tiene que ser positiva.":
      "The pressure must be positive.",
    "La presión tiene que ser una presión (me has dado %@).":
      "The pressure has to be a pressure (you gave me %@).",
    "La proporción de átomos es correcta, pero no el número: %@ tiene %lld átomos y %@ tiene %lld. ¿Has escrito la fórmula empírica en lugar de la molecular (o al revés)?":
      "The proportion of atoms is right, but the number isn't: %1$@ has %2$lld atoms and %3$@ has %4$lld. Did you write the empirical formula instead of the molecular one (or vice versa)?",
    "La subcapa %@ aparece dos veces.":
      "The subshell %@ appears twice.",
    "La temperatura absoluta tiene que ser mayor que 0 K.":
      "The absolute temperature has to be greater than 0 K.",
    "La temperatura tiene que ser una temperatura (me has dado %@).":
      "The temperature has to be a temperature (you gave me %@).",
    "La temperatura y la presión tienen que ser positivas.":
      "The temperature and pressure have to be positive.",
    "Las cifras significativas están bien, pero el valor no: debería salir %@.":
      "The significant figures are right, but the value isn’t: it should be %@.",
    "Las especies no coinciden con las de la reacción: %@":
      "The species don’t match those in the reaction: %@",
    "Las especies son las correctas, pero no está balanceada.":
      "The species are correct, but it isn’t balanced.",
    "Las proporciones entre elementos salen desorbitadas (más de 1000 a 1): revisa los datos.":
      "The ratios between elements are way off (more than 1000 to 1): check the data.",
    "Los números de oxidación de %@ suman %@ y la carga de la especie es %@: la fórmula no cuadra con las reglas. Revisa la fórmula o consulta los estados de oxidación posibles.":
      "The oxidation states of %@ add up to %@ but the species charge is %@: the formula does not match the rules. Check the formula or review the possible oxidation states.",
    "Los subíndices tienen que ser números enteros («%@…» no vale).":
      "Subscripts must be integers (“%@…” isn't valid).",
    "Los símbolos empiezan por mayúscula: ¿%@?":
      "Symbols start with a capital letter: is it %@?",
    "Los símbolos empiezan por mayúscula: ¿quisiste decir %@?":
      "Symbols start with a capital letter: did you mean %@?",
    "Los átomos están bien, pero la especie debería ser de carga %@ y la has escrito con carga %@.":
      "The atoms are right, but the species should have a charge of %1$@ and you wrote it with a charge of %2$@.",
    "Los átomos están bien, pero la especie debería ser de carga %@ y la has escrito sin carga.":
      "The atoms are right, but the species should have a charge of %@ and you wrote it with no charge.",
    "Los átomos están bien, pero la especie debería ser neutra y la has escrito con carga %@.":
      "The atoms are right, but the species should be neutral and you wrote it with a charge of %@.",
    "Los átomos y la carga cuadran, pero los coeficientes no guardan la proporción de esta reacción: con los mínimos queda %@.":
      "The atoms and charge add up, but the coefficients don't keep this reaction's ratio: in lowest terms it's %@.",
    "Necesito al menos un elemento con su masa o porcentaje.":
      "I need at least one item with its mass or percentage.",
    "Necesito la concentración, por ejemplo «HCl 0.01 M» o «CH3COOH 0.1 M Ka=1.8e-5».":
      "I need the concentration, for example \"HCl 0.01 M\" or \"CH3COOH 0.1 M Ka=1.8e-5\".",
    "No conozco la unidad «%@». Usa, por ejemplo: g, mg, kg, mol, mL, L, atm, kPa, mmHg, °C, K, M.":
      "I don't recognize the unit \"%@\". Use, for example: g, mg, kg, mol, mL, L, atm, kPa, mmHg, °C, K, M.",
    "No conozco la unidad «%@». Usa, por ejemplo: g, mol, moléculas, L, mL, atm, kPa, mmHg, K, °C.":
      "I don't recognize the unit \"%@\". Use, for example: g, mol, molecules, L, mL, atm, kPa, mmHg, K, °C.",
    "No encuentro un número en «%@». Escribe solo el resultado, por ejemplo 0.0450 o 4.50e-2.":
      "I can't find a number in “%@”. Just type the result, for example 0.0450 or 4.50e-2.",
    "No entiendo el valor de pH en «%@».":
      "I don't understand the pH value in “%@”.",
    "No entiendo el valor de pOH en «%@».":
      "I don't understand the pOH value in “%@”.",
    "No entiendo el «^» en medio de la fórmula. Las cargas van al final (SO4^2-) y los isótopos se escriben ^{14}C.":
      "I don't understand the “^” in the middle of the formula. Charges go at the end (SO4^2-) and isotopes are written as ^{14}C.",
    "No entiendo la cantidad «%@». Escríbela como número y unidad, por ejemplo «10 g», «0.5 mol» o «250 mL».":
      "I don't understand the quantity “%@”. Write it as a number and unit, for example “10 g”, “0.5 mol” or “250 mL”.",
    "No entiendo la concentración en «%@».":
      "I don't understand the concentration in “%@”.",
    "No entiendo la configuración «%@». Escríbela así: «1s2 2s2 2p6» o «[Ne] 3s1».":
      "I don't understand the configuration “%@”. Write it like this: “1s2 2s2 2p6” or “[Ne] 3s1”.",
    "No entiendo la referencia «%@».":
      "I don't understand the reference “%@”.",
    "No entiendo «%@» dentro de una fórmula química.":
      "I don't understand “%@” in a chemical formula.",
    "No es correcta.":
      "That's not correct.",
    "No es correcta: %@":
      "That's not correct: %@",
    "No es la fórmula esperada (%@).":
      "That's not the expected formula (%@).",
    "No pude leer tu respuesta.":
      "I couldn't read your answer.",
    "No puedo asignar los números de oxidación de %@ solo con las reglas: %@ quedan sin determinar (hay varias combinaciones posibles).":
      "I can't assign the oxidation numbers of %1$@ using the rules alone: %2$@ are left undetermined (several combinations are possible).",
    "No puedo calcular la masa molar de %@.":
      "I can't calculate the molar mass of %@.",
    "No puedo leer tu configuración.":
      "I can't read your settings.",
    "No puedo leer tu ecuación: %@":
      "I can't read your equation: %@",
    "No puedo leer tu fórmula: %@":
      "I can't read your formula: %@",
    "No reconozco «%@» como nombre de un compuesto. Revisa la ortografía (por ejemplo «sulfato de hierro(III)»).":
      "I don't recognize \"%@\" as a compound name. Check the spelling (for example \"sulfato de hierro(III)\").",
    "No se puede pasar de %@ a %@ directamente.":
      "Can't convert from %1$@ to %2$@ directly.",
    "No se pueden calcular los moles.":
      "Can't calculate the number of moles.",
    "No sé si %@ es fuerte o débil. Si es débil, dame su constante: «%@ %@ M Ka=…».":
      "I don't know whether %1$@ is strong or weak. If it's weak, give me its constant: “%2$@ %3$@ M Ka=…”.",
    "No sé si %@ es fuerte o débil. Si es débil, dame su constante: «%@ %@ M Kb=…».":
      "I don't know whether %1$@ is strong or weak. If it's weak, give me its constant: “%2$@ %3$@ M Kb=…”.",
    "Para pasar %@ a moles necesito la fórmula del soluto.":
      "To convert %@ to moles, I need the solute's formula.",
    "Para pasar a %@ necesito la fórmula de la sustancia (por ejemplo «H2O»).":
      "To convert to %@, I need the substance's formula (for example, \"H2O\").",
    "Para pasar a cantidad de sustancia necesito la fórmula de la sustancia (por ejemplo «H2O»).":
      "To convert to amount of substance, I need the substance's formula (for example, \"H2O\").",
    "Para pasar a masa necesito la fórmula de la sustancia (por ejemplo «H2O»).":
      "To convert to mass, I need the substance's formula (for example, \"H2O\").",
    "Para pasar a número de partículas necesito la fórmula de la sustancia (por ejemplo «H2O»).":
      "To convert to number of particles, I need the substance's formula (for example, \"H2O\").",
    "Para pasar a volumen necesito la fórmula de la sustancia (por ejemplo «H2O»).":
      "To convert to volume, I need the substance's formula (for example, \"H2O\").",
    "Para pasar a volumen necesito saber si es un gas en condiciones normales (escribe «L CN») o usa la ley de los gases con P y T.":
      "To convert to volume, I need to know whether it's a gas at standard conditions (type \"L CN\") or use the gas law with P and T.",
    "Para usar la masa del gas necesito su fórmula.":
      "To use the gas's mass, I need its formula.",
    "Parece un error de potencia de 10 (te sale %@): revisa las unidades o los prefijos (m, k…).":
      "Looks like a power-of-ten error (you got %@): check the units or the prefixes (m, k…).",
    "Revisa el estado del %@: debería ser (%@).":
      "Check the state of %1$@: it should be (%2$@).",
    "Revisa el signo.":
      "Check the sign.",
    "Revisa las mayúsculas: en química «Co» (cobalto) no es lo mismo que «CO» (monóxido de carbono).":
      "Check the capitalization: in chemistry, “Co” (cobalt) isn’t the same as “CO” (carbon monoxide).",
    "Revisa los subíndices o el número de oxidación (romano) del metal.":
      "Check the subscripts and the metal’s oxidation number (Roman).",
    "Sobra el %@ en los productos.":
      "%@ is extra in the products.",
    "Sobra el %@ en los reactivos.":
      "%@ is extra in the reactants.",
    "Sobra el %@: no forma parte de %@.":
      "%1$@ is extra: it isn't part of %2$@.",
    "Sobra un «%@»: se cierra algo que no se había abierto.":
      "Extra \"%@\": it closes something that was never opened.",
    "Sobra un «+» en los productos: falta una especie.":
      "Extra \"+\" in the products: a species is missing.",
    "Sobra un «+» en los reactivos: falta una especie.":
      "Extra \"+\" in the reactants: a species is missing.",
    "Te sale el doble o la mitad: revisa los coeficientes estequiométricos.":
      "Your answer is double or half: check the stoichiometric coefficients.",
    "Tiene los mismos átomos, pero está escrita de otra forma: se esperaba %@, no %@. Comprueba si te piden la fórmula desarrollada o la molecular.":
      "It has the same atoms, but written differently: %1$@ was expected, not %2$@. Check whether they're asking for the expanded or molecular formula.",
    "Tienes %lld electrones y %@ tiene %lld.":
      "You have %1$lld electrons and %2$@ has %3$lld.",
    "Un isótopo de %@ no puede tener número másico %@ (tiene al menos %@ protones).":
      "An isotope of %1$@ can't have a mass number of %2$@ (it has at least %3$@ protons).",
    "Un subíndice no puede ser 0: si el elemento no está, no lo escribas.":
      "A subscript can't be 0: if the element isn't there, don't write it.",
    "Un átomo de %@ solo tiene %lld electrones: no puede tener carga %@.":
      "An atom of %1$@ only has %2$lld electrons: it can't have a charge of %3$@.",
    "Una carga de %@ no es realista para un ion monoatómico.":
      "A charge of %@ isn't realistic for a monatomic ion.",
    "Una concentración sola no basta: dime también el volumen de la disolución («25 mL 0.10 M»).":
      "A concentration alone isn't enough: also tell me the volume of the solution (“25 mL 0.10 M”).",
    "[H₃O⁺] tiene que ser positiva.":
      "[H₃O⁺] must be positive.",
    "[OH⁻] tiene que ser positiva.":
      "[OH⁻] must be positive.",
    "cantidad de sustancia":
      "amount of substance",
    "en disolución acuosa":
      "in aqueous solution",
    "energía":
      "energy",
    "la cantidad dada":
      "the given quantity",
    "líquido":
      "liquid",
    "masa":
      "mass",
    "molalidad":
      "molality",
    "molaridad":
      "molarity",
    "número de partículas":
      "number of particles",
    "partículas":
      "particles",
    "presión":
      "pressure",
    "sólido":
      "solid",
    "temperatura":
      "temperature",
    "volumen":
      "volume",
    "¡Correcto!":
      "Correct!",
    "¡Correcto! %@":
      "Correct! %@",
    "¡Correcto! %@.":
      "Correct! %@.",
    "¡Correcto! (también se llama %@)":
      "Correct! (also called %@)",
    "¡Correcto! El valor y las cifras significativas (%lld) están bien.": {
      one: "Correct! The value and the significant figure (%lld) are right.",
      other: "Correct! The value and the significant figures (%lld) are right.",
    },
    "¡Correcto! Está balanceada (esta reacción admite más de un juego de coeficientes válido).":
      "Correct! It's balanced (this reaction allows more than one valid set of coefficients).",
    "¡Correcto! Está balanceada con los coeficientes mínimos.":
      "Correct! It's balanced with the minimum coefficients.",
    "¡Correcto! Está bien balanceada.":
      "Correct! It's balanced correctly.",
    "«%@» es solo un número: falta la fórmula química.":
      "“%@” is just a number: the chemical formula is missing.",
    "«%@» no aparece en la ecuación %@.":
      "“%1$@” doesn’t appear in equation %2$@.",
    "«%@» no es un símbolo químico.":
      "“%@” isn’t a chemical symbol.",
    "«%@» no es un símbolo químico. ¿Quisiste decir %@?":
      "“%1$@” isn’t a chemical symbol. Did you mean %2$@?",
    "«%@» no es válido: los símbolos químicos empiezan por mayúscula (Na, Cl, Fe…).":
      "“%@” isn’t valid: chemical symbols start with a capital letter (Na, Cl, Fe…).",
    "«[%@]» no es un gas noble: el núcleo abreviado tiene que ser [He], [Ne], [Ar], [Kr], [Xe] o [Rn].":
      "“[%@]” isn’t a noble gas: the abbreviated nucleus must be [He], [Ne], [Ar], [Kr], [Xe], or [Rn].",
    "¿De qué sustancia? Escribe la fórmula, por ejemplo «HCl 0.01 M».":
      "What substance? Type the formula, for example “HCl 0.01 M”.",
  },
}
