// Generado a partir del catálogo de la app Swift anterior. Ya no se regenera: este archivo es la fuente.
// Mensajes de MathKit que ve el estudiante (errores, correcciones), por idioma: clave = texto en español con los marcadores
// de Apple (%@, %lld, %1$@…); valor = traducción. Solo los idiomas de la interfaz de Aula (en español la clave es el
// texto, salvo las formas de plural y lo que el catálogo cambie).
// Para regenerarlo: extraer las claves de las llamadas `tr('…')` de src/engine/math y buscar cada una en el catálogo.

/** Una frase traducida o sus formas de plural («one», «other»…, como las variaciones de Apple). */
export type MathCatalogEntry = string | Readonly<Partial<Record<Intl.LDMLPluralRule, string>>>

/** Idiomas con catálogo propio (el español es el idioma base: sus claves ya son el texto). */
export type MathLanguage = "es" | "en"

export const MATH_MESSAGE_CATALOG: Readonly<Record<MathLanguage, Readonly<Record<string, MathCatalogEntry>>>> = {
  "es": {
    "Casi: revisa el redondeo; se pide con %lld decimales y hay que redondear solo al final de todos los cálculos.": {
      one: "Casi: revisa el redondeo; se pide con %lld decimal y hay que redondear solo al final de todos los cálculos.",
      other: "Casi: revisa el redondeo; se pide con %lld decimales y hay que redondear solo al final de todos los cálculos.",
    },
    "El valor es correcto, pero se pide redondeado a %lld decimales.": {
      one: "El valor es correcto, pero se pide redondeado a %lld decimal.",
      other: "El valor es correcto, pero se pide redondeado a %lld decimales.",
    },
    "Te faltan %lld soluciones.": {
      one: "Te falta %lld solución.",
      other: "Te faltan %lld soluciones.",
    },
  },
  "en": {
    "%@ solo está definido para números enteros":
      "%@ is only defined for integers",
    "%@(n, p, k), por ejemplo %@(10, 0.5, 3)":
      "%1$@(n, p, k), for example %2$@(10, 0.5, 3)",
    "%@(λ, k), por ejemplo %@(3, 2)":
      "%1$@(λ, k), for example %2$@(3, 2)",
    "(Corchete si el valor se incluye; paréntesis si no, o si es ∞ o hace cero un denominador.)":
      "(Bracket if the value is included; parenthesis if not, or if it's ∞ or makes a denominator zero.)",
    "0^0 es indeterminado":
      "0^0 is indeterminate",
    "Alguno de tus valores es una aproximación decimal: escribe los valores exactos (fracciones o radicales) o usa más cifras.":
      "Some of your values are decimal approximations: enter exact values (fractions or radicals) or use more digits.",
    "Algunos de tus valores no son solución: sustitúyelos en la ecuación original y revisa el dominio.":
      "Some of your values aren't solutions: substitute them into the original equation and check the domain.",
    "Cada desigualdad debe tener la variable de un lado y un número del otro (por ejemplo x < 3).":
      "Each inequality must have the variable on one side and a number on the other (for example, x < 3).",
    "Casi: los signos de tus soluciones están al revés.":
      "Almost: the signs in your solutions are flipped.",
    "Casi: revisa el redondeo; se pide con %lld decimales y hay que redondear solo al final de todos los cálculos.": {
      one: "Almost: check the rounding; it asks for %lld decimal place, and you should round only at the end of all calculations.",
      other: "Almost: check the rounding; it asks for %lld decimal places, and you should round only at the end of all calculations.",
    },
    "Casi: revisa el redondeo; se pide con 1 decimal y hay que redondear solo al final de todos los cálculos.":
      "Almost: check the rounding; it asks for 1 decimal place, and you should round only at the end of all calculations.",
    "Casi: revisa el signo de «%@» dentro de la expresión (aparece %@ donde debería haber -%@, o al revés).":
      "Almost: check the sign of \"%1$@\" in the expression (%2$@ appears where -%3$@ should be, or vice versa).",
    "Casi: revisa el signo de «%@» en tu ecuación.":
      "Almost: check the sign of \"%@\" in your equation.",
    "Casi: revisa el signo de «%@» y «%@» en tu ecuación.":
      "Almost: check the signs of \"%1$@\" and \"%2$@\" in your equation.",
    "Casi: revisa el signo de «%@», «%@» y «%@» en tu ecuación.":
      "Almost: check the signs of \"%1$@\", \"%2$@\" and \"%3$@\" in your equation.",
    "Casi: revisa la ortografía (%@).":
      "Almost: check the spelling (%@).",
    "Casi: sobra el signo menos; revisa el signo del resultado.":
      "Almost: you have an extra minus sign; check the sign of the result.",
    "Casi: te faltó el signo menos.":
      "Almost: you're missing the minus sign.",
    "Casi: tu expresión es la opuesta de la correcta; revisa un signo.":
      "Almost: your expression is the opposite of the correct one; check a sign.",
    "Cuidado con el signo: tu expresión coincide con la correcta solo cuando ésta es positiva (recuerda que √(x²) = |x|).":
      "Watch out for the sign: your expression matches the correct one only when it's positive (remember that √(x²) = |x|).",
    "Después de la lista de datos falta cerrar el paréntesis de «%@»":
      "After the data list, you still need to close the “%@” parenthesis",
    "El apóstrofo «'» no se usa en una expresión: para una derivada escribe solo la expresión (2x, no f'(x))":
      "The apostrophe \"'\" isn't used in an expression: for a derivative, type just the expression (2x, not f'(x))",
    "El arcocosecante solo existe para |x| ≥ 1":
      "The arcsecant only exists for |x| ≥ 1",
    "El arcocoseno solo existe para valores entre -1 y 1":
      "The arccosine only exists for values between -1 and 1",
    "El arcosecante solo existe para |x| ≥ 1":
      "The arccosecant only exists for |x| ≥ 1",
    "El arcoseno solo existe para valores entre -1 y 1":
      "The arcsine only exists for values between -1 and 1",
    "El ejercicio no tiene respuestas aceptadas.":
      "The exercise has no accepted answers.",
    "El extremo «%@» no es válido: %@.":
      "The endpoint \"%1$@\" isn't valid: %2$@.",
    "El factorial de %@ es demasiado grande":
      "The factorial of %@ is too big",
    "El factorial no está definido para números negativos":
      "The factorial isn't defined for negative numbers",
    "El factorial solo está definido para números enteros":
      "The factorial is only defined for whole numbers",
    "El infinito siempre va con paréntesis, nunca con corchete.":
      "Infinity always goes with parentheses, never with a bracket.",
    "El logaritmo solo existe para números positivos":
      "A logarithm is only defined for positive numbers",
    "El mínimo común múltiplo es demasiado grande":
      "The least common multiple is too large",
    "El nombre de variable «%@» no es válido: usa letras, números y guion bajo, sin empezar por número.":
      "The variable name \"%@\" is invalid: use letters, numbers, and underscores, and don't start with a number.",
    "El nombre «%@» está reservado (es una constante o un operador): elige otro nombre de variable.":
      "The name \"%@\" is reserved (it's a constant or an operator): choose another variable name.",
    "El número de decimales solo está definido para números enteros":
      "The number of decimal places is only defined for integers",
    "El número es demasiado grande":
      "The number is too large",
    "El número es demasiado grande para escribirlo así":
      "The number is too large to write it this way",
    "El número «%@» no es válido: %@.":
      "The number \"%1$@\" is invalid: %2$@.",
    "El rango de la variable «%@» es demasiado grande.":
      "The range of the variable \"%@\" is too large.",
    "El resultado de nCr es demasiado grande":
      "The nCr result is too large",
    "El resultado de nPr es demasiado grande":
      "The nPr result is too large",
    "El resultado es demasiado grande":
      "The result is too large",
    "El símbolo de grados «°» no está permitido aquí":
      "The degree symbol \"°\" isn't allowed here",
    "El valor es correcto, pero en notación científica la parte decimal debe estar entre 1 y 10 (por ejemplo %@e4).":
      "The value is correct, but in scientific notation the decimal part must be between 1 and 10 (for example %@e4).",
    "El valor es correcto, pero escríbelo como fracción (por ejemplo 3/4).":
      "The value is correct, but write it as a fraction (for example 3/4).",
    "El valor es correcto, pero escríbelo como fracción simplificada (por ejemplo 3/4).":
      "The value is correct, but write it as a simplified fraction (for example 3/4).",
    "El valor es correcto, pero escríbelo como número decimal (por ejemplo %@).":
      "The value is correct, but write it as a decimal number (for example %@).",
    "El valor es correcto, pero escríbelo como número entero.":
      "The value is correct, but write it as a whole number.",
    "El valor es correcto, pero escríbelo como número mixto (por ejemplo 1 3/4).":
      "The value is correct, but write it as a mixed number (for example 1 3/4).",
    "El valor es correcto, pero escríbelo como porcentaje, con el símbolo %.":
      "The value is correct, but write it as a percentage, with the % symbol.",
    "El valor es correcto, pero escríbelo en notación científica (por ejemplo %@e4 o %@×10^4).":
      "The value is correct, but write it in scientific notation (for example %1$@e4 or %2$@×10^4).",
    "El valor es correcto, pero falta simplificar la fracción.":
      "The value is correct, but the fraction still needs to be simplified.",
    "El valor es correcto, pero falta simplificar la fracción: %@/%@ = %@.":
      "The value is correct, but the fraction still needs to be simplified: %1$@/%2$@ = %3$@.",
    "El valor es correcto, pero se espera como decimal redondeado a %lld decimales: %@.":
      "The value is correct, but the expected answer is the decimal rounded to %1$lld decimal places: %2$@.",
    "El valor es correcto, pero se espera como decimal redondeado a 1 decimal: %@.":
      "The value is correct, but the expected answer is the decimal rounded to 1 decimal place: %@.",
    "El valor es correcto, pero se pide redondeado a %lld decimales.": {
      one: "The value is correct, but it needs to be rounded to %lld decimal place.",
      other: "The value is correct, but it needs to be rounded to %lld decimal places.",
    },
    "El valor es correcto, pero se pide redondeado a 1 decimal.":
      "The value is correct, but it asks for it rounded to 1 decimal place.",
    "El índice de la raíz no puede ser 0":
      "The index of the root can't be 0",
    "En %@ el área (probabilidad) debe estar entre 0 y 1, sin incluirlos":
      "In %@ the area (probability) must be between 0 and 1, exclusive",
    "En %@ la desviación típica σ debe ser un número positivo":
      "In %@ the standard deviation σ must be a positive number",
    "En este caso la expresión no está definida: la respuesta correcta es «indefinido» (DNE).":
      "In this case the expression isn't defined: the correct answer is “undefined” (DNE).",
    "En la binomial, k (número de éxitos) debe ser un número entero":
      "For the binomial, k (number of successes) must be an integer",
    "En la binomial, la probabilidad p debe estar entre 0 y 1":
      "For the binomial, the probability p must be between 0 and 1",
    "En la binomial, n (número de ensayos) debe ser un número entero":
      "For the binomial, n (number of trials) must be an integer",
    "En la binomial, n (número de ensayos) no puede ser negativo":
      "For the binomial, n (number of trials) can't be negative",
    "En la distribución de Poisson λ debe ser un número positivo":
      "For the Poisson distribution, λ must be a positive number",
    "En la restricción «%@»: %@":
      "In the constraint “%1$@”: %2$@",
    "En x = %@ debe ir corchete [ ].":
      "For x = %@, use brackets [ ].",
    "En x = %@ debe ir paréntesis ( ).":
      "For x = %@, use parentheses ( ).",
    "En zscore(x, μ, σ) la desviación típica σ debe ser positiva":
      "In zscore(x, μ, σ), the standard deviation σ must be positive",
    "Entendí %@ como %@; si querías %@ escribe %@":
      "I read %1$@ as %2$@; if you meant %3$@, type %4$@",
    "Entendí log(%@, %@) como el logaritmo en base %@ de %@; si querías el logaritmo de %@ en base %@, escribe log_%@(%@)":
      "I read log(%1$@, %2$@) as the logarithm of %4$@ to the base %3$@; if you wanted the logarithm of %5$@ to the base %6$@, write log_%7$@(%8$@)",
    "Es equivalente a la respuesta, pero todavía tiene letras: simplifícala hasta llegar a un número.":
      "It's equivalent to the answer, but it still has letters: simplify it until you get a number.",
    "Es equivalente, pero falta expandir: multiplica y reduce los términos semejantes.":
      "It's equivalent, but you still need to expand: multiply and combine like terms.",
    "Es equivalente, pero falta factorizar por completo.":
      "It's equivalent, but you still need to factor completely.",
    "Es equivalente, pero falta reducir la fracción a su mínima expresión.":
      "It's equivalent, but you still need to reduce the fraction to its simplest form.",
    "Es equivalente, pero falta simplificar.":
      "It's equivalent, but it still needs simplifying.",
    "Es equivalente, pero no puedes usar «%@» en esta respuesta.":
      "It's equivalent, but you can't use \"%@\" in this answer.",
    "Esa ecuación no es equivalente a la esperada: no tiene el mismo conjunto solución.":
      "That equation isn't equivalent to the expected one: it doesn't have the same solution set.",
    "Esa ecuación no tiene solución: sustituye tus valores en la ecuación original y revisa el dominio.":
      "That equation has no solution: substitute your values into the original equation and check the domain.",
    "Esa expresión no da un número real: %@.":
      "That expression doesn't give a real number: %@.",
    "Esa expresión sí está definida: revisa tu cálculo.":
      "That expression is defined: check your calculation.",
    "Esa palabra no admite subíndice":
      "That word can't have a subscript",
    "Esa potencia no es un número real (base negativa con exponente fraccionario)":
      "That power isn't a real number (negative base with a fractional exponent)",
    "Esas coordenadas son aproximaciones decimales de las correctas: escribe los valores exactos (fracciones, raíces como √2/2, π…).":
      "Those coordinates are decimal approximations of the correct ones: enter the exact values (fractions, roots like √2/2, π…).",
    "Escogiste justo los intervalos contrarios: revisa si buscabas donde la expresión es positiva (>) o negativa (<) y prueba un punto en cada intervalo.":
      "You picked exactly the opposite intervals: check whether you were looking for where the expression is positive (>) or negative (<), and test a point in each interval.",
    "Escribe al menos un valor, por ejemplo 2, -3.":
      "Enter at least one value, for example 2, -3.",
    "Escribe solo la expresión (sin ecuación): lo que va a la izquierda del «=» no es un nombre como y o f(x).":
      "Enter only the expression (not an equation): what goes to the left of the \"=\" isn't a name like y or f(x).",
    "Escribe solo la expresión, con un único signo «=» como máximo (por ejemplo f(x) = 2x+1).":
      "Enter only the expression, with at most a single \"=\" sign (for example f(x) = 2x+1).",
    "Escribe solo el número y la unidad (%@), sin más palabras.":
      "Write only the number and the unit (%@), with no other words.",
    "Escribe solo el número, sin unidades ni palabras detrás.":
      "Write only the number, without units or words after it.",
    "Escribe tu ecuación.":
      "Enter your equation.",
    "Escribe tu respuesta con letras o números.":
      "Enter your answer using letters or numbers.",
    "Escribe tu respuesta.":
      "Enter your answer.",
    "Escribe un solo punto, con el formato (x, y).":
      "Enter a single point, in (x, y) format.",
    "Escribe una expresión":
      "Enter an expression",
    "Eso es una desigualdad; aquí se espera una ecuación con «=»":
      "That's an inequality; an equation with \"=\" is expected here",
    "Estás a 1 de distancia de la respuesta: revisa el último paso (¿sumaste o restaste 1 de más?).":
      "You're 1 away from the answer: check the last step (did you add or subtract 1 by mistake?).",
    "Estás muy cerca: parece un problema de redondeo (redondea solo al final de todos los cálculos).":
      "You're very close: it looks like a rounding issue (only round at the very end of all calculations).",
    "Falta cerrar el subíndice":
      "Missing closing subscript",
    "Falta cerrar el valor absoluto con otra barra «|»":
      "Missing closing bar \"|\" to end the absolute value",
    "Falta cerrar un paréntesis":
      "Missing closing parenthesis",
    "Falta cerrar «}}» en la plantilla: «%@»":
      "Missing closing \"}}\" in the template: \"%@\"",
    "Falta el argumento de «%@»: por ejemplo %@":
      "Missing argument for \"%1$@\": for example %2$@",
    "Falta el argumento del logaritmo":
      "Missing argument for the logarithm",
    "Falta el argumento dentro de los paréntesis de «%@»":
      "Missing argument inside the parentheses of \"%@\"",
    "Falta el operador «*» antes de «%@»":
      "Missing \"*\" operator before \"%@\"",
    "Falta el signo «=» de la ecuación":
      "Missing \"=\" sign in the equation",
    "Falta el valor de la variable «%@»":
      "Missing value for variable \"%@\"",
    "Falta la coma entre los extremos del intervalo, por ejemplo (2, 5).":
      "Missing comma between the interval endpoints, for example (2, 5).",
    "Falta la expresión a la derecha del «=»":
      "Missing expression on the right of \"=\"",
    "Falta la expresión a la izquierda del «=»":
      "Missing expression on the left of \"=\"",
    "Falta la unidad (%@).":
      "Missing unit (%@).",
    "Falta la unidad.":
      "Missing the unit.",
    "Falta lo que va después del signo «=».":
      "Missing what comes after the “=” sign.",
    "Falta un número en uno de los extremos.":
      "Missing a number at one end.",
    "Falta un número o expresión antes de «%@»":
      "Missing a number or expression before “%@”",
    "Falta un operador antes de «%@»":
      "Missing an operator before “%@”",
    "Falta un operador antes de «%@»: escribe «%@» o usa paréntesis":
      "Missing an operator before “%1$@”: type “%2$@” or use parentheses",
    "Falta un operador antes de «%@»: escribe «*» entre los dos factores":
      "Missing an operator before “%@”: type “*” between the two factors",
    "Falta un operador antes de «%@»: para un subíndice escribe «%@»; para multiplicar, «%@»":
      "Missing an operator before “%1$@”: for a subscript, type “%2$@”; to multiply, type “%3$@”",
    "Falta una expresión junto al signo de comparación":
      "Missing an expression next to the comparison sign",
    "Faltan ideas clave: menciona al menos %lld.": {
      one: "Key ideas missing: mention at least %lld.",
      other: "Key ideas missing: mention at least %lld.",
    },
    "Fracción no válida":
      "Invalid fraction",
    "Hay demasiados valores: escribe solo las soluciones, separadas por comas.":
      "There are too many values: enter only the solutions, separated by commas.",
    "Hay un «=» donde no corresponde: aquí se espera solo una expresión":
      "There’s a “=” where it doesn’t belong: only an expression is expected here",
    "Hay un «{{ }}» vacío en la plantilla.":
      "There’s an empty “{{ }}” in the template.",
    "Hay una desigualdad («%@») donde no corresponde: aquí se espera solo una expresión":
      "There’s an inequality (“%@”) where it doesn’t belong: only an expression is expected here",
    "Incluiste algún intervalo que no cumple: prueba un punto de cada intervalo en la expresión original.":
      "You included an interval that doesn't hold: try one point from each interval in the original expression.",
    "La base del logaritmo debe ser positiva y distinta de 1":
      "The logarithm base must be positive and not equal to 1",
    "La base del logaritmo no es válida (%@)":
      "The logarithm base isn't valid (%@)",
    "La coordenada %@ está bien, pero la %@ no coincide.":
      "Coordinate %1$@ is correct, but %2$@ doesn't match.",
    "La coordenada %@ está bien, pero la %@ tiene el signo al revés.":
      "Coordinate %1$@ is correct, but %2$@ has the wrong sign.",
    "La coordenada %@ está bien.":
      "Coordinate %@ is correct.",
    "La coordenada %@ no coincide.":
      "Coordinate %@ doesn't match.",
    "La coordenada %@ tiene el signo al revés.":
      "Coordinate %@ has the wrong sign.",
    "La cosecante no está definida en ese ángulo":
      "The cosecant is undefined at that angle",
    "La cotangente no está definida en ese ángulo":
      "The cotangent is undefined at that angle",
    "La expresión es demasiado compleja o tiene demasiados niveles anidados":
      "The expression is too complex or has too many nested levels",
    "La expresión es demasiado larga (máximo %@ caracteres)":
      "The expression is too long (maximum %@ characters)",
    "La expresión es demasiado larga o complicada":
      "The expression is too long or complicated",
    "La expresión está incompleta: falta algo después de «%@»":
      "The expression is incomplete: something is missing after “%@”",
    "La expresión no puede empezar con «%@»":
      "The expression can’t start with “%@”",
    "La expresión tiene demasiados niveles anidados":
      "The expression has too many nested levels",
    "La operación no está definida":
      "The operation is undefined",
    "La plantilla usa «%@», pero esa variable no está definida (variables: %@).":
      "The template uses “%1$@”, but that variable isn't defined (variables: %2$@).",
    "La plantilla usa «%@», pero esa variable no está definida.":
      "The template uses “%@”, but that variable isn't defined.",
    "La raíz de un número negativo no es real":
      "The root of a negative number isn't real",
    "La raíz de índice par de un número negativo no es real":
      "The even root of a negative number isn't real",
    "La respuesta es demasiado larga.":
      "The answer is too long.",
    "La respuesta es demasiado larga: escríbela de forma más corta.":
      "The answer is too long: write it more briefly.",
    "La restricción está vacía":
      "The constraint is empty",
    "La secante no está definida en ese ángulo":
      "The secant is undefined at that angle",
    "La suma no está definida (∞ − ∞)":
      "The sum is undefined (∞ − ∞)",
    "La tangente no está definida en ese ángulo":
      "The tangent is undefined at that angle",
    "La unidad no corresponde: se esperaba una unidad de %@ (%@).":
      "The unit doesn't match: a unit of %1$@ (%2$@) was expected.",
    "La unidad no corresponde: se esperaba una unidad de %@.":
      "The unit doesn't match: a unit of %@ was expected.",
    "La variable «%@» está definida dos veces.":
      "The variable “%@” is defined twice.",
    "La variable «%@» no encontró ninguna fracción con esos límites.":
      "The variable “%@” didn't find any fraction with those limits.",
    "La variable «%@» no tiene ningún valor posible con %lld decimales entre %@ y %@.":
      "The variable “%1$@” has no possible value with %2$lld decimal places between %3$@ and %4$@.",
    "La variable «%@» no tiene ningún valor posible: el rango excluye todo.":
      "The variable “%@” has no possible value: the range excludes everything.",
    "La variable «%@» no tiene opciones para elegir.":
      "The variable “%@” has no options to choose from.",
    "La variable «%@» tiene el rango al revés (min %@ > max %@).":
      "The variable “%1$@” has its range backwards (min %2$@ > max %3$@).",
    "La variable «%@» tiene un rango real no válido.":
      "The variable “%@” has an invalid real range.",
    "La varianza y la desviación típica muestrales necesitan al menos 2 datos":
      "The sample variance and sample standard deviation need at least 2 data points",
    "Las coordenadas %@ y %@ están bien.":
      "The %1$@ and %2$@ coordinates are correct.",
    "Las coordenadas deben ser números, sin letras (aparece «%@»).":
      "Coordinates must be numbers, not letters (“%@”).",
    "Los datos deben ser números finitos":
      "The data must be finite numbers",
    "Los extremos deben ser números, sin letras (aparece «%@»).":
      "The endpoints must be numbers, with no letters (“%@” appears).",
    "Los extremos están al revés: el menor va primero.":
      "The endpoints are reversed: the smaller one comes first.",
    "Los grados de libertad deben ser un número positivo":
      "The degrees of freedom must be a positive number",
    "Los intervalos están bien, pero revisa los extremos.":
      "The intervals are right, but check the endpoints.",
    "Los intervalos están bien, pero revisa los extremos: en x = %@ debe ir corchete [ ].":
      "The intervals are right, but check the endpoints: at x = %@ you need a square bracket [ ].",
    "Los intervalos están bien, pero revisa los extremos: en x = %@ debe ir paréntesis ( ).":
      "The intervals are right, but check the endpoints: at x = %@ you need a parenthesis ( ).",
    "Los valores están bien, pero el orden importa.":
      "The values are right, but the order matters.",
    "Los valores son los correctos, pero la cantidad de repeticiones no coincide.":
      "The values are correct, but the number of repetitions doesn't match.",
    "Mencionaste %lld de %lld ideas clave: te falta incluir alguna.":
      "You mentioned %1$lld of %2$lld key ideas: you're missing one.",
    "Ninguna coordenada coincide: revisa el procedimiento.":
      "No coordinate matches: check the procedure.",
    "No aparece ninguna de las ideas clave que se esperan.":
      "None of the expected key ideas appear.",
    "No conozco la función «%@»":
      "I don't recognize the function \"%@\"",
    "No conozco la función «%@». ¿Quisiste decir «%@»?":
      "I don't recognize the function \"%1$@\". Did you mean \"%2$@\"?",
    "No encontré ningún intervalo.":
      "I couldn't find any range.",
    "No entiendo el signo de comparación «%@».":
      "I don't understand the comparison operator “%@”.",
    "No entiendo tu respuesta.":
      "I don't understand your answer.",
    "No entiendo «%@» como intervalo: usa notación como (1, 3] o desigualdades como x < 3.":
      "I don't understand “%@” as an interval: use notation like (1, 3] or inequalities like x < 3.",
    "No entiendo «%@» en este lugar":
      "I don't understand “%@” here",
    "No es correcto.":
      "That's not correct.",
    "No existe la raíz cuadrada (real) de un número negativo":
      "A negative number doesn't have a (real) square root",
    "No hay moda: ningún valor se repite":
      "There's no mode: no value repeats",
    "No hay una moda única: %@ se repiten %lld veces cada uno":
      "There's no single mode: each of %1$@ repeats %2$lld times",
    "No he podido comprobar a tiempo si tu ecuación tiene las mismas soluciones que la esperada: escríbela de forma más sencilla.":
      "I couldn't check in time whether your equation has the same solutions as the expected one: write it in a simpler way.",
    "No pude leer el extremo «%@» (%@).":
      "I couldn't read the endpoint \"%1$@\" (%2$@).",
    "No pude leer la coordenada «%@».":
      "I couldn't read the coordinate \"%@\".",
    "No pude leer la coordenada «%@»: %@.":
      "I couldn't read the coordinate \"%1$@\": %2$@.",
    "No pude leer tu ecuación. Escribe una ecuación con un solo «=», por ejemplo y = 2x + 1.":
      "I couldn't read your equation. Enter an equation with a single \"=\", for example y = 2x + 1.",
    "No pude leer tu ecuación: %@. Escribe una ecuación con un solo «=», por ejemplo y = 2x + 1.":
      "I couldn't read your equation: %@. Enter an equation with a single \"=\", for example y = 2x + 1.",
    "No pude leer tu expresión.":
      "I couldn't read your expression.",
    "No pude leer tu expresión: %@. Usa * para multiplicar, ^ para potencias, / para fracciones, y sqrt(), sin(), ln()… para funciones.":
      "I couldn't read your expression: %@. Use * to multiply, ^ for powers, / for fractions, and sqrt(), sin(), ln()… for functions.",
    "No pude leer tu intervalo.":
      "I couldn't read your interval.",
    "No pude leer tu respuesta como un número.":
      "I couldn't read your answer as a number.",
    "No pude leer tu respuesta.":
      "I couldn't read your answer.",
    "No pude leer «%@»":
      "I couldn't read \"%@\"",
    "No pude leer «%@» (%@)":
      "I couldn't read \"%1$@\" (%2$@)",
    "No pude leer «%@» como un número: %@.":
      "I couldn't read \"%1$@\" as a number: %2$@.",
    "No pude leer «%@»: %@.":
      "I couldn't read \"%1$@\": %2$@.",
    "No puedo comprobar esta respuesta con la precisión solicitada. Pide revisar el ejercicio.":
      "I cannot check this answer at the requested precision. Ask for the exercise to be reviewed.",
    "No reconozco el símbolo «%@»":
      "I don't recognize the symbol \"%@\"",
    "No reconozco la unidad «%@».":
      "I don't recognize the unit \"%@\".",
    "No se pudo cumplir las restricciones (%@) tras %lld intentos: revisa que los rangos de las variables las permitan.":
      "Couldn't satisfy the constraints (%1$@) after %2$lld attempts. Check that the variable ranges allow them.",
    "No se pudo interpretar el intervalo esperado del ejercicio («%@»).":
      "Couldn’t interpret the interval expected by the exercise (“%@”).",
    "No se pudo interpretar el punto esperado del ejercicio («%@»).":
      "Couldn’t interpret the point expected by the exercise (“%@”).",
    "No se pudo interpretar la ecuación esperada del ejercicio («%@»).":
      "Couldn’t interpret the equation expected by the exercise (“%@”).",
    "No se pudo interpretar la respuesta esperada del ejercicio («%@»).":
      "Couldn’t interpret the answer expected by the exercise (“%@”).",
    "No se puede calcular el módulo con divisor 0":
      "Can't calculate modulo with a zero divisor",
    "No se puede dividir entre cero":
      "Can't divide by zero.",
    "Número mal escrito":
      "Malformed number",
    "Número mal escrito: tiene dos puntos decimales":
      "Malformed number: it has two decimal points",
    "Parece que cortaste los decimales en lugar de redondear.":
      "Looks like you truncated the decimals instead of rounding.",
    "Parece que cortaste los decimales en lugar de redondear; escribe el valor exacto o redondea al final.":
      "Looks like you truncated the decimals instead of rounding; enter the exact value or round at the end.",
    "Parece que escribiste los ángulos en grados, pero aquí se leen en radianes: usa el símbolo ° (por ejemplo sin(30°)) o pasa el ángulo a radianes.":
      "Looks like you entered the angles in degrees, but they're read in radians here: use the ° symbol (for example sin(30°)) or convert the angle to radians.",
    "Parece que escribiste los ángulos en radianes, pero aquí se leen en grados: pasa el ángulo a grados (π rad = 180°).":
      "Looks like you entered the angles in radians, but they're read in degrees here: convert the angle to degrees (π rad = 180°).",
    "Parece que intercambiaste «%@» y «%@» (es la ecuación de la inversa).":
      "Looks like you swapped \"%1$@\" and \"%2$@\" (it's the equation for the inverse).",
    "Parece que mezclaste porcentaje y fracción (factor 100).":
      "Looks like you mixed up percentage and fraction (factor of 100).",
    "Parece que multiplicaste por 100 de más: revisa si la respuesta va en porcentaje o como fracción.":
      "Looks like you multiplied by 100 extra: check whether the answer should be a percentage or a fraction.",
    "Parece que olvidaste pasar a porcentaje: la respuesta está multiplicada por 100.":
      "Looks like you forgot to convert to a percentage: the answer is multiplied by 100.",
    "Parece que te faltó elevar al cuadrado.":
      "Looks like you forgot to square it.",
    "Parece que te faltó sacar la raíz cuadrada.":
      "Looks like you forgot to take the square root.",
    "Parece que usaste el recíproco: ¿invertiste el numerador y el denominador?":
      "Looks like you used the reciprocal: did you flip the numerator and the denominator?",
    "Parece que usaste grados donde la respuesta está en radianes.":
      "Looks like you used degrees where the answer is in radians.",
    "Parece que usaste radianes donde la respuesta está en grados.":
      "Looks like you used radians where the answer is in degrees.",
    "Revisa la conversión de unidades: el número coincide pero la unidad escrita (%@) no equivale a %@.":
      "Check the unit conversion: the number matches, but the unit you wrote (%1$@) isn’t equivalent to %2$@.",
    "Revisa la conversión de unidades: el número coincide pero la unidad escrita (%@) no equivale a la esperada.":
      "Check the unit conversion: the number matches, but the unit you wrote (%@) isn’t equivalent to the expected one.",
    "Revisa los signos de las coordenadas.":
      "Check the signs of the coordinates.",
    "Si es una diferencia de temperatura, está bien (una variación de 1 K es una variación de 1 °C); si es una temperatura, recuerda que K = °C + %@.":
      "If it's a temperature difference, that's fine (a change of 1 K is a change of 1 °C); if it's a temperature, remember that K = °C + %@.",
    "Sobra un paréntesis de cierre «%@»":
      "Extra closing parenthesis \"%@\"",
    "Sobra una barra de valor absoluto «|»":
      "Extra absolute value bar \"|\"",
    "Sobra una coma o punto y coma: aquí no se admiten listas":
      "Extra comma or semicolon: lists aren't allowed here",
    "Subíndice no válido":
      "Invalid subscript",
    "Sí hay solución: revisa si descartaste un valor que en realidad era válido.":
      "There is a solution: check whether you discarded a value that was actually valid.",
    "Te falta incluir alguna parte de la solución: revisa la tabla de signos, ese intervalo también cumple.":
      "You're missing part of the solution: check the sign chart, that interval works too.",
    "Te falta una solución: revisa si descartaste un valor válido o si la ecuación tiene más de una raíz.":
      "You're missing a solution: check whether you discarded a valid value or the equation has more than one root.",
    "Te faltan %lld soluciones.": {
      one: "You're missing %lld solution.",
      other: "You're missing %lld solutions.",
    },
    "Tienes las coordenadas %@ y %@ intercambiadas: el orden es (%@).":
      "You have the %1$@ and %2$@ coordinates swapped: the order is (%3$@).",
    "Tu conjunto no coincide con la solución: rehaz la tabla de signos, marca los valores críticos y une solo los intervalos que cumplen.":
      "Your answer doesn't match the solution: redo the sign chart, mark the critical values, and join only the intervals that satisfy it.",
    "Tu conjunto no coincide: acertaste %lld de %lld.":
      "Your answer doesn't match: you got %1$lld of %2$lld right.",
    "Tu conjunto no coincide: ningún valor es correcto.":
      "Your answer doesn't match: none of the values are correct.",
    "Tu decimal es una aproximación del valor exacto: escribe el valor exacto (fracción o radical) o usa más cifras.":
      "Your decimal is an approximation of the exact value: enter the exact value (fraction or radical) or use more digits.",
    "Tu decimal es una aproximación del valor exacto: escribe el valor exacto (fracción, raíz, π…).":
      "Your decimal is an approximation of the exact value: enter the exact value (fraction, root, π…).",
    "Tu expresión depende de «%@», pero la respuesta es un número: revisa el procedimiento.":
      "Your expression depends on “%@”, but the answer is a number: check your work.",
    "Tu expresión difiere de la correcta por un factor de 10^%@.":
      "Your expression differs from the correct one by a factor of 10^%@.",
    "Tu expresión es el doble de la correcta: revisa si te sobra un factor 2.":
      "Your expression is twice the correct one: check whether you have an extra factor of 2.",
    "Tu expresión es el recíproco de la correcta: ¿intercambiaste numerador y denominador?":
      "Your expression is the reciprocal of the correct one: did you swap numerator and denominator?",
    "Tu expresión es la mitad de la correcta: revisa si te falta un factor 2.":
      "Your expression is half the correct one: check whether you're missing a factor of 2.",
    "Tu expresión es un múltiplo constante de la correcta: revisa el coeficiente.":
      "Your expression is a constant multiple of the correct one: check the coefficient.",
    "Tu expresión se diferencia de la correcta en 1: revisa el término independiente.":
      "Your expression differs from the correct one by 1: check the constant term.",
    "Tu expresión se diferencia de la correcta en una constante: revisa el término independiente.":
      "Your expression differs from the correct one by a constant: check the constant term.",
    "Tu lista no coincide.":
      "Your list doesn't match.",
    "Tu lista no coincide: acertaste %lld de %lld.":
      "Your list doesn't match: you got %1$lld of %2$lld right.",
    "Tu número coincide con el resultado expresado en %@, pero aquí se pide en %@: convierte la unidad y escríbela.":
      "Your number matches the result expressed in %1$@, but here it's requested in %2$@: convert the unit and write it.",
    "Tu número coincide con el resultado expresado en %@, pero aquí se pide en %@: convierte la unidad.":
      "Your number matches the result expressed in %1$@, but here it's asked for in %2$@: convert the unit.",
    "Tu número es una aproximación decimal del valor exacto: escribe el valor exacto (fracción, raíz, π…).":
      "Your number is a decimal approximation of the exact value: enter the exact value (fraction, root, π…).",
    "Tu respuesta difiere por un factor de 100.":
      "Your answer differs by a factor of 100.",
    "Tu respuesta difiere por un factor de 10^%@: revisa la coma decimal o la conversión de unidades.":
      "Your answer differs by a factor of 10^%@: check your decimal separator or the unit conversion.",
    "Tu respuesta es el doble de la correcta: revisa si te sobra un factor 2.":
      "Your answer is twice the correct one: check whether you have an extra factor of 2.",
    "Tu respuesta es la mitad de la correcta: revisa si te falta un factor 2.":
      "Your answer is half the correct one: check whether you're missing a factor of 2.",
    "Tu respuesta tiene la letra «%@»: aquí se espera un número (o una expresión numérica como sqrt(2)/2).":
      "Your answer contains the character “%@”: a number (or a numeric expression like sqrt(2)/2) is expected here.",
    "Tus valores coinciden donde las dos expresiones existen, pero el dominio no es el mismo: revisa raíces, logaritmos, valores absolutos y denominadores.":
      "Your values match wherever both expressions exist, but the domain isn't the same: check roots, logarithms, absolute values, and denominators.",
    "Un intervalo con los dos extremos iguales solo existe como [a, a].":
      "An interval with both endpoints equal only exists as [a, a].",
    "Un intervalo tiene solo dos extremos, por ejemplo (2, 5).":
      "An interval has only two endpoints, for example (2, 5).",
    "Un punto de %lld coordenadas se escribe así: %@. Tú escribiste %lld valor(es).":
      "A point with %1$lld coordinates is written like this: %2$@. You entered %3$lld value(s).",
    "Una de las coordenadas no es un número real.":
      "One of the coordinates isn't a real number.",
    "Una ecuación lleva un solo signo «=»":
      "An equation has only one “=” sign",
    "Une los intervalos con el símbolo ∪ (puedes escribir la letra U): por ejemplo (-inf, -2) U (4, inf).":
      "Join the intervals with the ∪ symbol (you can type the letter U): for example (-inf, -2) U (4, inf).",
    "Uno de tus valores no es solución: sustitúyelo en la ecuación original y revisa el dominio (¿solución extraña?).":
      "One of your values isn't a solution: substitute it into the original equation and check the domain (extraneous solution?).",
    "Usa solo la variable %@ (no «%@»).":
      "Use only the variable %1$@ (not “%2$@”).",
    "Usa solo las variables %@ (no «%@»).":
      "Use only the variables %1$@ (not “%2$@”).",
    "Usa una sola variable en las desigualdades (aparecen «%@» y «%@»).":
      "Use a single variable in the inequalities (“%1$@” and “%2$@” both appear).",
    "aceleración":
      "acceleration",
    "acosh solo existe para x ≥ 1":
      "acosh is only defined for x ≥ 1",
    "atan2(0, 0) no está definido":
      "atan2(0, 0) is undefined",
    "atanh solo existe para |x| < 1":
      "atanh is only defined for |x| < 1",
    "calor específico":
      "specific heat",
    "cantidad de sustancia":
      "amount of substance",
    "cantidad por masa":
      "amount per mass",
    "capacidad térmica":
      "heat capacity",
    "capacitancia":
      "capacitance",
    "carga eléctrica":
      "electric charge",
    "chi2cdf(a, b, gl), por ejemplo chi2cdf(0, 3.84, 1)":
      "chi2cdf(a, b, df), for example chi2cdf(0, 3.84, 1)",
    "chi2pdf no está definida en x = 0 con menos de 2 grados de libertad":
      "chi2pdf is undefined at x = 0 with fewer than 2 degrees of freedom",
    "chi2pdf(x, gl)":
      "chi2pdf(x, df)",
    "concentración molar":
      "molar concentration",
    "constante de los gases":
      "gas constant",
    "corriente eléctrica":
      "electric current",
    "densidad":
      "density",
    "energía":
      "energy",
    "frecuencia":
      "frequency",
    "fuerza":
      "force",
    "indefinido":
      "undefined",
    "invnorm(0.975) o invnorm(p, μ, σ)":
      "invnorm(0.975) or invnorm(p, μ, σ)",
    "invt(p, gl), por ejemplo invt(0.975, 10)":
      "invt(p, df), for example invt(0.975, 10)",
    "k debe ser un número entero":
      "k must be an integer",
    "longitud":
      "length",
    "masa":
      "mass",
    "masa molar":
      "molar mass",
    "nCr necesita números no negativos":
      "nCr requires nonnegative numbers",
    "nPr necesita números no negativos":
      "nPr requires nonnegative numbers",
    "normalcdf(-1.96, 1.96) o normalcdf(a, b, μ, σ)":
      "normalcdf(-1.96, 1.96) or normalcdf(a, b, μ, σ)",
    "potencia":
      "power",
    "presión":
      "pressure",
    "resistencia":
      "resistance",
    "tcdf(a, b, gl), por ejemplo tcdf(-2, 2, 10)":
      "tcdf(a, b, df), for example tcdf(-2, 2, 10)",
    "temperatura":
      "temperature",
    "tiempo":
      "time",
    "una cantidad sin unidades":
      "a quantity with no units",
    "velocidad":
      "speed",
    "voltaje":
      "voltage",
    "volumen":
      "volume",
    "«%@» es un texto (%@), no un número: no se puede usar en una cuenta.":
      "“%1$@” is text (%2$@), not a number: it can’t be used in a calculation.",
    "«%@» necesita %lld argumentos y recibió %lld: por ejemplo %@":
      "“%1$@” needs %2$lld arguments and received %3$lld: for example %4$@",
    "«%@» necesita 1 argumento y recibió %lld: por ejemplo %@":
      "“%1$@” requires 1 argument but received %2$lld—for example %3$@",
    "«%@» necesita al menos %lld argumentos y recibió %lld: por ejemplo %@":
      "“%1$@” needs at least %2$lld arguments and received %3$lld: for example %4$@",
    "«%@» necesita al menos 1 argumento y recibió %lld: por ejemplo %@":
      "“%1$@” requires at least 1 argument but received %2$lld—for example %3$@",
    "«%@» necesita el número de cifras entre paréntesis: por ejemplo {{%@(2):x}}.":
      "“%1$@” needs the number of digits in parentheses: for example {{%2$@(2):x}}.",
    "«%@» necesita entre %lld y %lld argumentos y recibió %lld: por ejemplo %@":
      "“%1$@” needs between %2$lld and %3$lld arguments and received %4$lld: for example %5$@",
    "«%@» necesita paréntesis: por ejemplo %@":
      "“%1$@” needs parentheses: for example %2$@",
    "«%@» recibe demasiados argumentos":
      "“%@” takes too many arguments",
    "«%@» recibió %lld argumento(s) y no los admite":
      "“%1$@” received %2$lld argument(s) and doesn't accept them",
    "«%@» tiene la letra «%@»: escribe solo números (o expresiones numéricas), separados por comas":
      "“%1$@” contains the letter “%2$@”: type only numbers (or numeric expressions), separated by commas",
    "«mod» necesita un número a cada lado (por ejemplo 7 mod 3)":
      "“mod” needs a number on each side (for example 7 mod 3)",
    "ángulo":
      "angle",
    "área":
      "area",
  },
}
