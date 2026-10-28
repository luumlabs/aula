// Tablas del clasificador de peligro (port de ComputerKit/Safety/DangerClassifier.swift y DangerPhrases+Platforms.swift).
// Etiquetas reales de Canvas, Moodle, Blackboard, Google Classroom, Teams, Brightspace, Schoology, Sakai, itslearning y Open edX
// en es, en, pt-BR, fr, de, it, zh-Hans, ja, ko, ru, ar e hi (paquetes de idioma oficiales de Moodle 4.4, canvas-lms, Sakai,
// edx-platform y ayudas localizadas). Las frases se escriben tal cual y se normalizan al cargar (acentos y mayúsculas no importan).
export type DangerCategory =
  | 'submit' | 'assessment' | 'delete' | 'message' | 'payment' | 'logout' | 'unenroll' | 'permission' | 'consent' | 'credentials'
  | 'modify' | 'upload' | 'closeWindow' | 'externalApp' | 'system'

export type RuleMode = 'exact' | 'prefix' | 'contains' | 'containsNonLink'

export type PhraseTable = [DangerCategory, RuleMode, string[]][]

/** Español e inglés (base). */
export const BASE_TABLE: PhraseTable = [
  // Entregar
  ['submit', 'prefix', ['submit', 'resubmit', 're submit', 'turn in', 'turn it in', 'hand in', 'entregar', 'reentregar', 'volver a entregar']],
  ['submit', 'contains', ['submit assignment', 'submit quiz', 'submit exam', 'submit test', 'submit answers', 'submit attempt', 'submit for grading',
    'submit work', 'submit now', 'confirm submission', 'save and submit', 'finish attempt', 'finish quiz', 'finish exam',
    'finish test', 'end exam', 'end quiz', 'end attempt', 'turn in assignment', 'hand in assignment',
    'enviar tarea', 'enviar examen', 'enviar respuestas', 'enviar intento', 'enviar entrega', 'enviar cuestionario',
    'enviar todo y terminar', 'terminar intento', 'terminar examen', 'terminar cuestionario', 'terminar prueba',
    'finalizar intento', 'finalizar examen', 'finalizar cuestionario', 'finalizar prueba', 'confirmar entrega',
    'guardar y enviar', 'entregar tarea', 'entregar examen', 'entregar trabajo', 'enviar trabajo']],
  ['submit', 'exact', ['finish', 'finalizar', 'terminar', 'i m done', 'im done']],
  // Exámenes
  ['assessment', 'exact', ['start', 'begin', 'resume', 'retake', 're take', 'attempt', 'comenzar', 'empezar', 'iniciar', 'realizar', 'reanudar',
    'rendir', 'start now', 'begin now', 'comenzar ahora', 'empezar ahora', 'iniciar ahora']],
  ['assessment', 'contains', ['take the quiz', 'take quiz', 'take the exam', 'take exam', 'take the test', 'take test', 'take the survey',
    'take survey', 'take assessment', 'take the assessment', 'take midterm', 'take the midterm', 'take final',
    'take the final', 'start quiz', 'start the quiz', 'start exam', 'start the exam', 'start test', 'start the test',
    'start assessment', 'start attempt', 'start new attempt', 'start survey', 'start proctoring', 'start honorlock',
    'begin quiz', 'begin the quiz', 'begin exam', 'begin test', 'begin assessment', 'begin attempt',
    'resume quiz', 'resume exam', 'resume test', 'resume attempt', 'resume assessment',
    'continue quiz', 'continue exam', 'continue attempt', 'continue test', 'continue assessment',
    'retake quiz', 'retake exam', 'retake test', 'retake the quiz', 'take the quiz again', 'restart quiz',
    'restart exam', 'restart attempt', 'new attempt', 'another attempt', 'attempt quiz', 'attempt now',
    'launch quiz', 'launch exam', 'launch test', 'launch assessment', 'launch proctoring', 'launch honorlock',
    'lockdown browser',
    'realizar examen', 'realizar el examen', 'realizar cuestionario', 'realizar el cuestionario', 'realizar prueba',
    'realizar la prueba', 'realizar evaluacion', 'realizar la evaluacion', 'realizar intento',
    'comenzar examen', 'comenzar el examen', 'comenzar cuestionario', 'comenzar el cuestionario', 'comenzar intento',
    'comenzar evaluacion', 'comenzar prueba', 'empezar examen', 'empezar el examen', 'empezar cuestionario',
    'empezar intento', 'empezar prueba', 'empezar evaluacion', 'iniciar examen', 'iniciar el examen',
    'iniciar intento', 'iniciar cuestionario', 'iniciar evaluacion', 'iniciar prueba', 'reanudar examen',
    'reanudar intento', 'reanudar cuestionario', 'reanudar prueba', 'continuar examen', 'continuar el examen',
    'continuar intento', 'continuar el ultimo intento', 'continuar cuestionario', 'volver a realizar',
    'volver a hacer el examen', 'rehacer examen', 'repetir examen', 'repetir cuestionario', 'nuevo intento',
    'otro intento', 'intente resolver el cuestionario', 'resolver el cuestionario', 'presentar examen',
    'presentar el examen', 'rendir examen', 'rendir el examen', 'hacer el examen', 'hacer examen',
    'hacer el cuestionario']],
  // Exámenes: variantes que se colaban (J3-12): Moodle en español «Volver a intentar el cuestionario», Blackboard,
  // Brightspace, Schoology («Tomar/Hacer/Resolver/Abrir el examen…», «Go to quiz») y el lanzamiento LTI de New Quizzes
  ['assessment', 'contains', ['intentar el cuestionario', 'intentar cuestionario', 'intentar el examen', 'intentar examen', 'intentar la prueba',
    'tomar el examen', 'tomar examen', 'tomar la prueba', 'tomar prueba', 'tomar el cuestionario', 'tomar cuestionario', 'tomar la evaluacion',
    'hacer la prueba', 'hacer prueba', 'hacer la evaluacion', 'hacer el test', 'resolver examen', 'resolver el examen', 'resolver la prueba',
    'resolver prueba', 'resolver cuestionario', 'abrir examen', 'abrir el examen', 'abrir cuestionario', 'abrir el cuestionario',
    'abrir prueba', 'abrir la prueba', 'iniciar tarea', 'iniciar la tarea', 'open exam', 'open the exam', 'open quiz', 'open the quiz',
    'open test', 'open assessment', 'go to quiz', 'go to the quiz', 'go to exam', 'go to the exam', 'go to test', 'go to assessment',
    'take the test now', 'try quiz', 'try the quiz']],
  ['assessment', 'exact', ['launch', 'lancer', 'jetzt beginnen']],
  // Borrar
  ['delete', 'prefix', ['delete', 'remove', 'discard', 'erase', 'trash', 'destroy', 'purge', 'uninstall', 'unlink', 'revoke', 'clear all',
    'clear history', 'clear data', 'clear everything', 'empty trash', 'move to trash', 'permanently delete',
    'delete permanently', 'eliminar', 'borrar', 'quitar', 'suprimir', 'descartar', 'vaciar', 'desinstalar', 'revocar',
    'mover a la papelera', 'enviar a la papelera', 'limpiar todo', 'limpiar historial', 'eliminar definitivamente',
    'borrar definitivamente']],
  ['delete', 'containsNonLink', ['delete', 'remove', 'discard', 'erase', 'eliminar', 'borrar', 'descartar']],
  // Mensajes y publicaciones
  ['message', 'prefix', ['send', 'post', 'reply', 'publish', 'comment', 'share', 'invite', 'tweet', 'forward message', 'forward email',
    'enviar', 'publicar', 'responder', 'comentar', 'compartir', 'reenviar', 'invitar']],
  ['message', 'contains', ['send message', 'send email', 'send reply', 'send now', 'post reply', 'post comment', 'post message', 'add comment',
    'submit comment', 'submit reply', 'reply all', 'reply to', 'enviar mensaje', 'enviar correo', 'enviar respuesta',
    'publicar respuesta', 'publicar comentario', 'anadir comentario', 'agregar comentario', 'responder a todos']],
  ['message', 'exact', ['like', 'me gusta', 'upvote', 'dislike']],
  // Pagos
  ['payment', 'prefix', ['pay', 'buy', 'purchase', 'checkout', 'check out', 'subscribe', 'upgrade', 'donate', 'rent', 'redeem', 'renew',
    'pagar', 'comprar', 'suscribir', 'suscribirse', 'suscribirme', 'suscribete', 'donar', 'alquilar', 'canjear', 'renovar',
    'mejorar plan']],
  ['payment', 'contains', ['place order', 'order now', 'add to cart', 'add to bag', 'add payment', 'add card', 'add credit card',
    'start free trial', 'start trial', 'free trial', 'make a payment', 'make payment', 'submit payment',
    'complete purchase', 'confirm purchase', 'confirm payment', 'complete payment', 'buy now', 'pay now',
    'use latepass', 'redeem latepass', 'use a latepass', 'realizar pedido', 'hacer pedido', 'finalizar compra',
    'confirmar compra', 'confirmar pago', 'anadir al carrito', 'agregar al carrito', 'anadir tarjeta', 'agregar tarjeta',
    'anadir metodo de pago', 'agregar metodo de pago', 'prueba gratuita', 'iniciar prueba gratuita', 'comprar ahora',
    'pagar ahora']],
  // Cerrar sesión
  ['logout', 'prefix', ['log out', 'logout', 'log off', 'logoff', 'sign out', 'signout', 'sign off', 'cerrar sesion', 'cerrar la sesion',
    'finalizar sesion', 'desconectarse', 'desconectar', 'salir de la cuenta', 'salir de la sesion']],
  ['logout', 'contains', ['log out', 'sign out', 'logout', 'cerrar sesion', 'cerrar la sesion']],
  ['logout', 'exact', ['salir', 'exit', 'end session', 'switch account', 'cambiar de cuenta', 'cambiar cuenta']],
  // Bajas
  ['unenroll', 'prefix', ['unenroll', 'un enroll', 'drop course', 'drop class', 'drop this course', 'drop the course', 'withdraw', 'leave course',
    'leave the course', 'leave group', 'leave this group', 'leave the group', 'unsubscribe', 'opt out',
    'cancel enrollment', 'cancel registration', 'cancel subscription', 'cancel membership', 'deregister', 'unregister',
    'dar de baja', 'darse de baja', 'darme de baja', 'abandonar', 'salir del curso', 'salir del grupo', 'retirarse',
    'retirarme', 'retirar materia', 'retirar asignatura', 'cancelar inscripcion', 'cancelar matricula', 'anular matricula',
    'anular inscripcion', 'cancelar suscripcion', 'desuscribir', 'desuscribirse', 'desinscribir', 'desinscribirse',
    'desmatricular', 'desmatricularse']],
  ['unenroll', 'contains', ['unenroll', 'drop course', 'drop this course', 'leave course', 'leave group', 'darse de baja', 'dar de baja',
    'darme de baja', 'abandonar el curso', 'abandonar curso', 'cancelar matricula', 'cancelar inscripcion']],
  ['unenroll', 'exact', ['baja', 'drop', 'leave']],
  // Permisos
  ['permission', 'prefix', ['allow', 'always allow', 'grant', 'authorize', 'authorise', 'approve', 'trust', 'install', 'permitir', 'conceder',
    'autorizar', 'aprobar', 'confiar', 'instalar']],
  ['permission', 'contains', ['allow downloads', 'allow notifications', 'allow location', 'allow access', 'allow camera', 'allow microphone',
    'allow pop ups', 'allow popups', 'always allow', 'grant access', 'enable notifications', 'turn on notifications',
    'share location', 'share my location', 'share screen', 'share your screen', 'add extension', 'add to chrome',
    'add to safari', 'trust this site', 'trust this computer', 'permitir descargas', 'permitir notificaciones',
    'permitir ubicacion', 'permitir acceso', 'permitir siempre', 'conceder acceso', 'activar notificaciones',
    'compartir ubicacion', 'compartir pantalla', 'confiar en este sitio', 'anadir extension', 'agregar extension']],
  // Consentimiento
  ['consent', 'prefix', ['accept', 'agree', 'i agree', 'i accept', 'join', 'enroll', 'enrol', 'register', 'sign up', 'signup', 'create account',
    'acepto', 'unirse', 'unirme', 'inscribirse', 'inscribirme', 'matricularse', 'matricularme', 'registrarse', 'registrarme',
    'crear cuenta', 'estoy de acuerdo', 'de acuerdo y continuar']],
  ['consent', 'contains', ['accept all', 'accept cookies', 'accept all cookies', 'accept terms', 'accept invitation', 'accept the invitation',
    'agree and continue', 'accept and continue', 'aceptar todo', 'aceptar todas', 'aceptar cookies',
    'aceptar todas las cookies', 'aceptar terminos', 'aceptar los terminos', 'aceptar invitacion',
    'aceptar la invitacion', 'aceptar y continuar', 'acepto los terminos', 'unirse al curso',
    'decline invitation', 'rechazar invitacion']],
  ['consent', 'exact', ['decline', 'rechazar']],
  // Credenciales
  ['credentials', 'prefix', ['log in', 'login', 'log on', 'logon', 'sign in', 'signin', 'iniciar sesion', 'inicia sesion', 'acceder con',
    'entrar con', 'continue with google', 'continue with microsoft', 'continue with apple', 'continue with facebook',
    'continuar con google', 'continuar con microsoft', 'continuar con apple', 'sign in with', 'log in with',
    'iniciar sesion con', 'show password', 'mostrar contrasena']],
  ['credentials', 'contains', ['log in', 'sign in', 'iniciar sesion', 'forgot password', 'forgot your password', 'reset password',
    'change password', 'save password', 'update password', 'olvide mi contrasena', 'olvidaste tu contrasena',
    'cambiar contrasena', 'restablecer contrasena', 'recuperar contrasena', 'guardar contrasena', 'two factor',
    'verification code']],
  ['credentials', 'exact', ['acceder', 'entrar', 'ingresar', 'verify', 'verificar', 'authenticate', 'autenticar', 'sso']],
  // Cambios en la cuenta
  ['modify', 'prefix', ['save', 'update profile', 'update settings', 'update account', 'update email', 'update preferences', 'mark as',
    'mark all', 'mark complete', 'mark done', 'dismiss', 'rename', 'archive', 'unpublish', 'restore', 'reset', 'change',
    'set as default', 'make default', 'guardar', 'actualizar perfil', 'actualizar configuracion', 'actualizar datos',
    'actualizar cuenta', 'actualizar preferencias', 'marcar como', 'marcar todo', 'marcar todos', 'ignorar', 'renombrar',
    'archivar', 'despublicar', 'restaurar', 'restablecer', 'cambiar', 'establecer como']],
  // Subir archivos
  ['upload', 'prefix', ['upload', 'attach', 'choose file', 'choose files', 'browse files', 'browse for file', 'select file', 'select files',
    'add file', 'add files', 'drop files', 'subir', 'adjuntar', 'elegir archivo', 'elegir archivos', 'seleccionar archivo',
    'seleccionar archivos', 'examinar', 'cargar archivo', 'cargar archivos', 'anadir archivo', 'agregar archivo',
    'anadir archivos', 'agregar archivos']],
  ['upload', 'contains', ['upload file', 'upload files', 'upload submission', 'attach file', 'attach files', 'choose file', 'subir archivo',
    'subir archivos', 'adjuntar archivo', 'adjuntar archivos', 'seleccionar archivo', 'elegir archivo']],
  // Ventanas y sistema
  ['closeWindow', 'prefix', ['close window', 'close tab', 'close all windows', 'close all tabs', 'cerrar ventana', 'cerrar pestana',
    'cerrar todas las ventanas', 'cerrar todas las pestanas']],
  ['system', 'prefix', ['quit', 'force quit', 'forzar salida', 'shut down', 'shutdown']],
  ['system', 'exact', ['restart', 'reiniciar', 'apagar', 'lock screen', 'bloquear pantalla']]
]

/** Botones de las plataformas en los demás idiomas (y lo que faltaba en inglés y español). */
export const PLATFORM_TABLE: PhraseTable = [
  // ── Inglés: lo que faltaba de las plataformas ──
  ['assessment', 'contains', ['attempt quiz', 'attempt quiz now', 'continue your attempt', 'continue the last attempt', 're attempt quiz', 'reattempt quiz',
    'return to attempt', 'start quiz', 'start test', 'start new attempt', 'start timed exam', 'start proctored exam',
    'begin assessment', 'continue attempt', 'start assignment']],
  ['assessment', 'exact', ['start new', 'start exam', 'continue quiz']],
  ['submit', 'contains', ['submit all and finish', 'submit all your answers and finish', 'go to submit quiz', 'add submission', 'edit submission',
    'create submission', 're submit assignment', 'turn in again', 'turn in late', 'turn in for group', 'undo turn in', 'unsubmit',
    'hand in', 'save and submit']],
  ['submit', 'exact', ['turn in', 'unsubmit', 'finish attempt']],
  ['message', 'contains', ['post to forum', 'reply to forum', 'reply privately', 'add discussion topic', 'add a new discussion topic', 'reply to topic',
    'start a new thread', 'new conversation', 'add class comment', 'add private comment']],
  ['modify', 'contains', ['mark as complete', 'mark as completed', 'mark complete', 'mark as done', 'mark as read']],
  // ── Español (variantes que faltaban) ──
  ['assessment', 'contains', ['intento de cuestionario', 'intente resolver el cuestionario', 'reintentar el cuestionario', 'volver al intento',
    'continuar para intentar', 'continuar el examen', 'empezar tarea', 'iniciar nuevo', 'comenzar intento', 'iniciar evaluacion',
    'empezar examen']],
  ['submit', 'contains', ['entregar todas sus respuestas y terminar', 'agregar entrega', 'anadir entrega', 'editar entrega', 'borrar entrega',
    'enviado para calificar', 'enviar para calificar', 'entregar examen', 'presentar tarea', 'entregar tarea de nuevo',
    'crear entrega', 'anular entrega', 'deshacer la entrega', 'entreguela de nuevo']],
  ['message', 'contains', ['enviar al foro', 'responder al foro', 'responder en privado', 'anadir un nuevo tema de debate', 'responder al tema',
    'contestar al tema']],
  ['modify', 'contains', ['marcar como hecha', 'marcar como completado', 'marcar como completada', 'marcar como tarea completada']],
  // ── Portugués (Brasil) ──
  ['assessment', 'contains', ['tentativa do questionario', 'tentar responder o questionario', 'iniciar tentativa', 'continuar sua tentativa',
    'continuar a tentativa', 'prosseguir na tentativa', 'fazer uma outra tentativa', 'retornar a tentativa', 'fazer o teste',
    'fazer o teste novamente', 'retomar o teste', 'iniciar tarefa', 'iniciar avaliacao', 'iniciar prova', 'comecar prova',
    'comecar o teste', 'iniciar teste', 'iniciar questionario', 'nova tentativa', 'iniciar novo']],
  ['assessment', 'exact', ['comecar', 'iniciar', 'retomar']],
  ['submit', 'contains', ['finalizar tentativa', 'enviar tudo e terminar', 'enviar todas as suas respostas e finalizar', 'adicionar envio', 'editar envio',
    'remover envio', 'enviar tarefa', 'enviar tarefa em definitivo', 'submeter para avaliacao', 'submeter para correcao', 'enviar teste',
    'reenviar tarefa', 'salvar e enviar', 'criar envio', 'cancelar envio', 'anular entrega', 'entregue novamente', 'entregar tarefa']],
  ['submit', 'exact', ['entregar', 'submeter', 'ressubmeter']],
  ['message', 'contains', ['enviar mensagem ao forum', 'responder ao forum', 'resposta privada', 'adicionar topico de discussao', 'postar resposta',
    'responder ao topico', 'enviar mensagem']],
  ['message', 'exact', ['responder', 'postar', 'publicar', 'enviar']],
  ['modify', 'contains', ['marcar como feito', 'marcar como concluido', 'marcar como concluida']],
  ['logout', 'contains', ['sair da conta', 'encerrar sessao', 'terminar sessao']],
  ['logout', 'exact', ['sair']],
  ['delete', 'prefix', ['excluir', 'apagar', 'remover']],
  ['upload', 'prefix', ['carregar arquivo', 'enviar arquivo', 'anexar arquivo', 'escolher arquivo', 'adicionar arquivo']],
  // ── Francés ──
  ['assessment', 'contains', ['effectuer le test', 'faire le test', 'continuer votre tentative', 'continuer la tentative', 'effectuer de nouveau le test',
    'demarrer une tentative', 'commencer la tentative', 'retour a la tentative', 'repondre au questionnaire',
    'completer a nouveau le questionnaire', 'reprendre le questionnaire', 'commencer le travail', "commencer l'évaluation",
    'commencer le test', 'commencer le quiz', 'demarrer le test', 'demarrer le quiz', 'nouvelle tentative', 'passer le test',
    "passer l'examen"]],
  ['assessment', 'exact', ['commencer', 'demarrer', 'reprendre']],
  ['submit', 'contains', ['terminer le test', 'tout envoyer et terminer', 'envoyer toutes vos reponses et terminer', 'ajouter un travail', 'modifier le travail',
    'supprimer travail remis', 'envoyer le devoir', 'envoyer pour evaluation', 'envoyer le questionnaire', 'soumettre le devoir',
    'renvoyer le devoir', 'envoyer un travail', 'remettre pour notation', 'enregistrer et soumettre', 'creer une soumission',
    'rendre le devoir', "annuler l'envoi", 'annuler le rendu', 'remettre le devoir']],
  ['submit', 'exact', ['rendre', 'remettre', 'soumettre', 'envoyer']],
  ['message', 'contains', ['repondre au forum', 'repondre en prive', 'ajouter une discussion', 'publier une reponse', 'reponse au sujet', 'envoyer message',
    'envoyer un message', 'nouvelle discussion']],
  ['message', 'exact', ['repondre', 'publier', 'commenter', 'partager']],
  ['modify', 'contains', ['marquer comme termine', 'marquer termine', 'marquer comme lu']],
  ['logout', 'prefix', ['se deconnecter', 'deconnexion', 'fermer la session']],
  ['delete', 'prefix', ['supprimer', 'effacer']],
  ['upload', 'prefix', ['televerser', 'deposer un fichier', 'ajouter un fichier', 'choisir un fichier', 'joindre un fichier']],
  ['unenroll', 'contains', ['se desinscrire', 'me desinscrire', 'quitter le cours']],
  // ── Alemán ──
  ['assessment', 'contains', ['test versuchen', 'test jetzt durchführen', 'versuch fortsetzen', 'test wiederholen',
    'versuch beginnen', 'versuch starten', 'zurück zum versuch', 'quiz absolvieren', 'quiz erneut absolvieren', 'quiz fortsetzen',
    'mit aufgabe beginnen', 'prüfung starten', 'test starten', 'quiz starten', 'neuer versuch', 'neu starten']],
  ['submit', 'contains', ['versuch abschließen', 'versuch beenden', 'alle antworten absenden und beenden', 'aufgabenlösung hinzufügen', 'abgabe bearbeiten',
    'lösung entfernen', 'aufgabe abgeben', 'aufgabe erneut abgeben', 'zur bewertung abgeben', 'zur bewertung einreichen', 'quiz abgeben',
    'erneut einreichen', 'als gruppe einreichen', 'speichern und senden', 'einreichung erstellen', 'abgabe rückgängig machen']],
  ['submit', 'exact', ['abgeben', 'einreichen', 'absenden', 'zurückziehen']],
  ['message', 'contains', ['beitrag absenden', 'im forum antworten', 'privat antworten', 'neues thema hinzufügen', 'antwort posten', 'auf thema antworten',
    'nachricht senden']],
  ['message', 'exact', ['antworten', 'senden', 'posten', 'veröffentlichen', 'kommentieren', 'teilen']],
  ['modify', 'contains', ['als erledigt kennzeichnen', 'als erledigt markieren', 'als fertig markieren', 'als gelesen markieren']],
  ['logout', 'prefix', ['abmelden', 'ausloggen']],
  ['delete', 'prefix', ['löschen', 'entfernen']],
  ['upload', 'prefix', ['hochladen', 'datei hochladen', 'datei auswählen', 'datei hinzufügen']],
  ['unenroll', 'contains', ['vom kurs abmelden', 'aus kurs austragen', 'kurs verlassen']],
  // ── Italiano ──
  ['assessment', 'contains', ['tenta il quiz', 'tenta il quiz adesso', 'prosegui il tentativo', 'ritenta il quiz', 'avvia il tentativo', 'torna al tentativo',
    'esegui il quiz', 'esegui di nuovo il quiz', 'riprendi quiz', 'riprendi il quiz', 'avvia compito', 'inizia il test',
    'inizia il quiz', 'inizia la verifica', 'nuovo tentativo']],
  ['assessment', 'exact', ['inizia', 'avvia', 'riprendi']],
  ['submit', 'contains', ['termina il tentativo', 'completa il tentativo', 'invia e termina', 'inviare le risposte e terminare', 'aggiungi consegna',
    'modifica consegna', 'elimina consegna', 'consegna compito', 'consegna per la valutazione', 'invia quiz', 'invia compito',
    'invia di nuovo compito', 'annulla invio', 'annulla consegna', 'annullare la consegna', 'consegnare di nuovo']],
  ['submit', 'exact', ['consegna', 'invia']],
  ['message', 'contains', ['invia al forum', 'replica al forum', 'rispondi privatamente', 'aggiungi argomento di discussione', 'pubblica risposta',
    "rispondi all'argomento", 'invia messaggio']],
  ['message', 'exact', ['rispondi', 'pubblica', 'commenta', 'condividi']],
  ['modify', 'contains', ['spunta come completato', 'contrassegna come fatto', 'contrassegna come completato', 'segna come completato']],
  ['logout', 'prefix', ['esci', 'disconnetti', "esci dall'account"]],
  ['delete', 'prefix', ['elimina', 'cancella', 'rimuovi']],
  ['upload', 'prefix', ['carica file', 'carica un file', 'scegli file', 'aggiungi file']],
  // ── Ruso ──
  ['assessment', 'contains', ['пройти тест', 'начать тестирование', 'продолжить текущую попытку', 'пройти тест заново', 'снова пройти тест', 'начать попытку',
    'вернуться к попытке', 'возобновить контрольную работу', 'начать задание', 'новая попытка', 'начать тест', 'начать экзамен',
    'продолжить попытку']],
  ['assessment', 'exact', ['начать', 'продолжить тест']],
  ['submit', 'contains', ['закончить попытку', 'отправить всё и завершить тест', 'отправить все свои ответы и закончить', 'добавить ответ на задание',
    'редактировать ответ', 'удалить ответ', 'отправить на проверку', 'представить для оценивания', 'отправить контрольную работу',
    'отправить задание', 'отправить задание заново', 'отменить отправку', 'отменить сдачу', 'сдать задание', 'сдать работу',
    'завершить тест', 'завершить попытку']],
  ['submit', 'exact', ['сдать', 'отправить']],
  ['message', 'contains', ['отправить в форум', 'ответить в форум', 'личный ответ', 'добавить тему для обсуждения', 'опубликовать ответ', 'ответ по теме',
    'отправить сообщение']],
  ['message', 'exact', ['ответить', 'опубликовать', 'комментировать', 'поделиться']],
  ['modify', 'contains', ['отметить как выполненный', 'отметить как выполненное', 'отметить как прочитанное']],
  ['logout', 'prefix', ['выйти', 'выход', 'выйти из системы']],
  ['delete', 'prefix', ['удалить', 'стереть']],
  ['upload', 'prefix', ['загрузить файл', 'выбрать файл', 'прикрепить файл', 'добавить файл']],
  ['unenroll', 'contains', ['отписаться от курса', 'покинуть курс']],
  // ── Árabe ──
  ['assessment', 'contains', ['محاولة الاختبار', 'محاولة أداء الاختبار الآن', 'إستمر في محاولتك', 'استمر في محاولتك', 'إعادة محاولة الاختبار', 'إبدأ المحاولة',
    'ابدأ المحاولة', 'بدء المحاولة', 'متابعة المحاولة', 'عودة إلى المحاولة', 'أداء الاختبار', 'أداء الاختبار مرة أخرى',
    'استئناف الاختبار', 'بدء المهمة', 'ابدأ التقييم', 'محاولة جديدة', 'البدء من جديد', 'بدء الاختبار', 'ابدأ الاختبار']],
  ['assessment', 'exact', ['بدء', 'ابدأ']],
  ['submit', 'contains', ['إنهاء المحاولة', 'تسليم الكل وإنهاء الاختبار', 'أتريد تسليم كل إجاباتك والانهاء', 'إضافة تسليم', 'تحرير التسليم', 'إزالة التسليم',
    'تسليم الواجب', 'التسليم لغرض التقييم', 'إرسال اختبار', 'إرسال المهمة', 'إعادة إرسال المهمة', 'إرسال من أجل التقدير',
    'إعادة التقديم', 'حفظ وإرسال', 'إنشاء واجب مرسل', 'إلغاء الإرسال', 'إلغاء التسليم']],
  ['submit', 'exact', ['تسليم', 'إرسال', 'أرسل']],
  ['message', 'contains', ['أضف المنشور للمنتدى', 'رد على المنتدى', 'الرد بشكل خاص', 'إضافة موضوع للمناقشة', 'نشر رد', 'موضوع الرد', 'إرسال رسالة']],
  ['message', 'exact', ['رد', 'نشر', 'تعليق', 'مشاركة']],
  ['modify', 'contains', ['التأشير بأنه منجز', 'وضع علامة تم', 'تعليم كمكتمل']],
  ['logout', 'prefix', ['تسجيل الخروج', 'خروج']],
  ['delete', 'prefix', ['حذف', 'إزالة']],
  ['upload', 'prefix', ['رفع ملف', 'تحميل ملف', 'اختيار ملف', 'إرفاق ملف']],
  // ── Hindi ──
  ['assessment', 'contains', ['प्रश्नोत्तरी का प्रयास करें', 'अब प्रश्नोत्तरी का प्रयास करें', 'अपना प्रयास जारी रखें', 'पुनः प्रश्नोत्तरी का प्रयास करें', 'प्रयास शुरू करें',
    'प्रयास पर लौटें', 'प्रश्नोत्तरी में भाग लें', 'फिर से प्रश्नोत्तरी में भाग लें', 'प्रश्नोत्तरी फिर से शुरू करें', 'असाइनमेंट शुरू करें',
    'एसेसमेंट शुरू करें', 'नया प्रयास', 'परीक्षा शुरू करें', 'टेस्ट शुरू करें', 'क्विज़ शुरू करें']],
  ['assessment', 'exact', ['शुरू करें', 'प्रारंभ करें']],
  ['submit', 'contains', ['प्रयास समाप्त करें', 'सब कुछ जमा करें और समाप्त करें', 'अपने सभी उत्तर जमा करें और समाप्त करें', 'प्रस्तुति जोड़ें', 'सबमिशन संपादित करें',
    'सबमिशन हटा दें', 'कार्यभार जमा करें', 'ग्रेडिंग के लिए जमा करें', 'प्रश्नोत्तरी सबमिट करें', 'असाइनमेंट सबमिट करें', 'फिर से सबमिट करें',
    'अनसबमिट करें']],
  ['submit', 'exact', ['जमा करें', 'सबमिट करें', 'ज़मा करे', 'सबमिट']],
  ['message', 'contains', ['फोरम में पोस्ट करें', 'फोरम को जवाब दें', 'निजी तौर पर जवाब दें', 'चर्चा का विषय जोड़ें', 'उत्तर पोस्ट करें', 'विषय को जवाब दें', 'संदेश भेजें']],
  ['message', 'exact', ['उत्तर दीजिए', 'जवाब दें', 'पोस्ट करें', 'भेजें']],
  ['modify', 'contains', ['जैसा किया गया है उसे चिह्नित करें', 'हो गया के रूप में चिह्नित करें', 'हो गया के तौर पर मार्क करें']],
  ['logout', 'prefix', ['लॉग आउट', 'साइन आउट']],
  ['delete', 'prefix', ['हटाएं', 'मिटाएं', 'डिलीट करें']],
  ['upload', 'prefix', ['अपलोड करें', 'फ़ाइल अपलोड करें', 'फ़ाइल चुनें']],
  // ── Chino (simplificado): sin espacios → se busca como subcadena ──
  ['assessment', 'contains', ['尝试测验', '现在试答', '继续你的试答', '重新试答', '开始试答', '返回试答', '进行测验', '再次参加测验', '继续测验', '开始任务',
    '开始测验', '开始考试', '开始答题', '开始作答', '新尝试', '继续答题']],
  ['assessment', 'exact', ['开始']],
  ['submit', 'contains', ['结束试答', '全部提交并结束', '提交你所有的答案', '添加作业', '编辑作业', '移除作业', '提交作业', '提交以评分', '提交测验', '重新提交',
    '提交待打分', '再次上交', '撤消上交', '撤销上交', '取消提交', '交卷', '提交试卷']],
  ['submit', 'exact', ['提交', '上交']],
  ['message', 'contains', ['发到讨论区', '回复讨论区', '私下回复', '添加话题', '帖子回复', '回复主题', '发送消息', '发表评论']],
  ['message', 'exact', ['回复', '发布', '发送', '评论', '分享']],
  ['modify', 'contains', ['标记完成', '标记为完成', '标为已完成', '标记为已读']],
  ['logout', 'prefix', ['退出登录', '注销', '登出']],
  ['delete', 'prefix', ['删除', '移除']],
  ['upload', 'prefix', ['上传', '选择文件', '添加文件']],
  // ── Japonés ──
  ['assessment', 'contains', ['小テストを受験', '問題を受験', 'あなたの受験を続ける', 'もう一度受験', '受験を開始', '受験に戻る', '小テストに答える',
    'もう一度小テストに答える', '小テストの再開', '課題を開始', 'テストを開始', 'チャレンジを開始', '試行を続行', '新しい試行',
    '試験を開始', '受験する']],
  ['assessment', 'exact', ['開始', '受験']],
  ['submit', 'contains', ['テストを終了', '受験を終了', 'すべての解答を送信', 'あなたの解答すべてを送信', '提出をアップロード', '提出を編集', '提出を削除',
    '課題を提出', '評定のために送信', '小テストの提出', '課題の再提出', '採点のために提出', '保存して提出', '提出の作成',
    '提出を取り消', '再度提出', '再提出', '解答を送信']],
  ['submit', 'exact', ['提出', '送信', '提出する']],
  ['message', 'contains', ['フォーラムに投稿', 'フォーラムに返信', 'プライベートに返信', 'ディスカッショントピックを追加', '返信の投稿', 'トピックへ返信',
    'メッセージを送信']],
  ['message', 'exact', ['返信', '掲示', '投稿', '投稿する', 'コメント', '共有']],
  ['modify', 'contains', ['完了マーク', '完了にする', '完了としてマーク', '既読にする']],
  ['logout', 'prefix', ['ログアウト', 'サインアウト']],
  ['delete', 'prefix', ['削除']],
  ['upload', 'prefix', ['アップロード', 'ファイルを選択', 'ファイルを追加']],
  // ── Coreano ──
  ['assessment', 'contains', ['퀴즈 풀기', '지난번 시도 계속', '계속 시도하기', '퀴즈에 재도전', '시도 시작', '시도로 돌아가기', '퀴즈 다시', '과제 시작',
    '새 시도', '시험 시작', '퀴즈 시작', '응시하기', '응시 시작']],
  ['assessment', 'exact', ['시작', '시작하기', '새로 시작']],
  ['submit', 'contains', ['시도 종료', '모두 제출', '제출 추가', '제출물 편집', '과제 제출', '채점을 위한 제출', '퀴즈 제출', '저장 후 제출', '제출 만들기',
    '제출 취소', '다시 제출', '제출하기']],
  ['submit', 'exact', ['제출']],
  ['message', 'contains', ['포럼에 올리기', '포럼에 답글', '비공개로 답변', '새 토론 주제', '답변 게시', '주제에 대해 답변', '메시지 보내기']],
  ['message', 'exact', ['답글', '회신', '게시', '보내기', '댓글', '공유']],
  ['modify', 'contains', ['완료로 표시', '읽음으로 표시']],
  ['logout', 'prefix', ['로그아웃']],
  ['delete', 'prefix', ['삭제']],
  ['upload', 'prefix', ['업로드', '파일 선택', '파일 추가']]
]

/**
 * Botones que cambian algo en la plataforma sin entregar ni publicar (A2-P1-5): votar, valorar, fijar, favoritos, actualizar,
 * ocultar, pedir una prórroga, reservar, confirmar la asistencia… En los 12 idiomas. Aula solo lee: estos no se pulsan nunca.
 */
export const STATE_TABLE: PhraseTable = [
  // ── Inglés ──
  ['modify', 'exact', ['vote', 'rate', 'pin', 'unpin', 'star', 'unstar', 'favorite', 'favourite', 'unfavorite', 'unfavourite', 'bookmark', 'follow', 'unfollow',
    'update', 'hide', 'unhide', 'book', 'reserve', 'check in', 'checkin', 'rsvp', 'going', 'not going', 'attend', 'im here', 'present', 'enable', 'disable']],
  ['modify', 'prefix', ['vote for', 'rate this', 'add rating', 'add to favorites', 'add to favourites', 'add to my', 'add to dashboard', 'add to calendar',
    'mark attendance', 'record attendance', 'take attendance', 'confirm attendance', 'confirm my attendance', 'request extension', 'request an extension',
    'ask for an extension', 'ask for extension', 'request regrade', 'request a regrade', 'request access', 'book a', 'book an', 'book slot', 'book this',
    'reserve a', 'reserve slot', 'reserve this', 'sign up for', 'cancel booking', 'cancel reservation', 'turn on', 'turn off', 'pin to', 'pin this',
    'hide from', 'hide this', 'update status', 'update my', 'add reaction', 'react', 'opt in', 'claim']],
  // ── Español ──
  ['modify', 'exact', ['votar', 'valorar', 'puntuar', 'calificar', 'fijar', 'desfijar', 'anclar', 'desanclar', 'favorito', 'destacar', 'actualizar',
    'ocultar', 'reservar', 'presente', 'asistire', 'asistir', 'activar', 'desactivar']],
  ['modify', 'prefix', ['votar por', 'añadir a favoritos', 'agregar a favoritos', 'marcar como favorito', 'añadir a mi', 'agregar a mi', 'añadir al calendario',
    'agregar al calendario', 'añadir al panel', 'confirmar asistencia', 'confirmar mi asistencia', 'registrar asistencia', 'marcar asistencia', 'tomar asistencia',
    'solicitar prórroga', 'solicitar una prórroga', 'pedir prórroga', 'pedir una prórroga', 'solicitar extensión', 'solicitar una extensión', 'pedir extensión',
    'solicitar revisión', 'solicitar acceso', 'reservar plaza', 'reservar cita', 'reservar turno', 'reservar un', 'reservar una', 'cancelar reserva',
    'cancelar la reserva', 'apuntarse', 'apuntarme', 'ocultar del', 'ocultar de', 'ocultar este', 'ocultar esta', 'fijar en', 'fijar arriba', 'reaccionar',
    'añadir reacción']],
  // ── Portugués (Brasil) ──
  ['modify', 'exact', ['votar', 'avaliar', 'fixar', 'desafixar', 'favoritar', 'atualizar', 'ocultar', 'reservar', 'agendar', 'presente', 'ativar', 'desativar']],
  ['modify', 'prefix', ['adicionar aos favoritos', 'confirmar presença', 'registrar presença', 'marcar presença', 'solicitar prorrogação', 'solicitar extensão',
    'pedir prorrogação', 'reservar horário', 'cancelar reserva']],
  // ── Francés ──
  ['modify', 'exact', ['voter', 'noter', 'évaluer', 'épingler', 'désépingler', 'masquer', 'réserver', 'présent', 'activer', 'désactiver']],
  ['modify', 'prefix', ['mettre à jour', 'ajouter aux favoris', 'confirmer la présence', 'confirmer ma présence', 'enregistrer la présence',
    'demander une prolongation', 'demander un délai', 'demander une extension', 'réserver un créneau', 'annuler la réservation']],
  // ── Alemán ──
  ['modify', 'exact', ['abstimmen', 'bewerten', 'anheften', 'ausblenden', 'aktualisieren', 'buchen', 'reservieren', 'einchecken', 'anwesend', 'aktivieren',
    'deaktivieren']],
  ['modify', 'prefix', ['zu favoriten hinzufügen', 'als favorit markieren', 'anwesenheit bestätigen', 'anwesenheit erfassen', 'verlängerung beantragen',
    'fristverlängerung beantragen', 'termin buchen', 'buchung stornieren']],
  // ── Italiano ──
  ['modify', 'exact', ['vota', 'valuta', 'fissa', 'nascondi', 'aggiorna', 'prenota', 'presente', 'attiva', 'disattiva']],
  ['modify', 'prefix', ['aggiungi ai preferiti', 'conferma presenza', 'registra presenza', 'richiedi proroga', 'richiedi estensione', 'prenota uno slot',
    'prenota un', 'annulla prenotazione']],
  // ── Ruso ──
  ['modify', 'exact', ['голосовать', 'проголосовать', 'оценить', 'закрепить', 'открепить', 'скрыть', 'обновить', 'забронировать', 'записаться', 'включить',
    'выключить']],
  ['modify', 'prefix', ['добавить в избранное', 'подтвердить присутствие', 'отметить присутствие', 'запросить продление', 'попросить продление',
    'забронировать время', 'отменить бронирование']],
  // ── Árabe ──
  ['modify', 'exact', ['تصويت', 'صوت', 'تقييم', 'قيم', 'تثبيت', 'إخفاء', 'تحديث', 'حجز', 'احجز', 'تفعيل', 'تعطيل']],
  ['modify', 'prefix', ['إضافة إلى المفضلة', 'أضف إلى المفضلة', 'تأكيد الحضور', 'تسجيل الحضور', 'طلب تمديد', 'حجز موعد', 'إلغاء الحجز']],
  // ── Hindi ──
  ['modify', 'exact', ['वोट करें', 'वोट दें', 'रेट करें', 'पिन करें', 'छिपाएं', 'अपडेट करें', 'बुक करें', 'आरक्षित करें']],
  ['modify', 'prefix', ['पसंदीदा में जोड़ें', 'उपस्थिति दर्ज करें', 'उपस्थिति की पुष्टि करें', 'विस्तार का अनुरोध करें', 'समय बढ़ाने का अनुरोध करें',
    'बुकिंग रद्द करें']],
  // ── Chino (simplificado) ──
  ['modify', 'exact', ['投票', '评分', '置顶', '取消置顶', '收藏', '更新', '隐藏', '预约', '预订', '签到', '启用', '停用']],
  ['modify', 'contains', ['加入收藏', '添加到收藏', '确认出席', '确认出勤', '申请延期', '申请延长', '预约时间', '取消预约']],
  // ── Japonés ──
  ['modify', 'exact', ['投票', '評価', '評価する', 'ピン留め', 'お気に入り', '更新', '非表示', '予約', '予約する', 'チェックイン', '出席', '有効にする',
    '無効にする']],
  ['modify', 'contains', ['お気に入りに追加', '出席を確認', '出席登録', '出席する', '延長を申請', '期限延長', '予約をキャンセル', 'ピン留めする']],
  // ── Coreano ──
  ['modify', 'exact', ['투표', '투표하기', '평가', '평가하기', '고정', '고정 해제', '즐겨찾기', '업데이트', '숨기기', '예약', '예약하기', '체크인', '출석',
    '활성화', '비활성화']],
  ['modify', 'contains', ['즐겨찾기에 추가', '즐겨찾기 추가', '출석 확인', '출석 체크', '출석하기', '연장 신청', '기한 연장', '예약 취소']]
]

/**
 * Botones sin dirección que solo enseñan algo (A2-P1-5): página siguiente o anterior, «ver más», desplegar o plegar, buscar,
 * filtrar, ordenar, descargar, cerrar. Se pulsan sin preguntar (si su etiqueta no es peligrosa); un botón que no está aquí
 * pide permiso. Valen tal cual o al principio de la etiqueta («Ver más anuncios»).
 */
export const VIEW_LABELS = [
  // inglés
  'next', 'next page', 'previous', 'previous page', 'prev', 'back', 'first', 'last', 'newer', 'older', 'more', 'show more', 'see more', 'load more', 'view more',
  'read more', 'show all', 'view all', 'see all', 'show less', 'see less', 'expand', 'expand all', 'collapse', 'collapse all', 'show', 'view', 'open', 'details',
  'show details', 'view details', 'search', 'filter', 'filters', 'sort', 'sort by', 'close', 'cancel', 'menu', 'toggle navigation', 'navigation', 'zoom in',
  'zoom out', 'download', 'preview', 'go to', 'jump to', 'skip to',
  // español
  'siguiente', 'pagina siguiente', 'anterior', 'pagina anterior', 'atras', 'volver', 'primera', 'ultima', 'mas', 'ver mas', 'mostrar mas', 'cargar mas',
  'leer mas', 'mostrar todo', 'mostrar todos', 'ver todo', 'ver todos', 'ver menos', 'mostrar menos', 'expandir', 'expandir todo', 'contraer', 'contraer todo',
  'plegar', 'desplegar', 'mostrar', 'ver', 'abrir', 'detalles', 'ver detalles', 'buscar', 'filtrar', 'filtros', 'ordenar', 'ordenar por', 'cerrar', 'cancelar',
  'menu', 'descargar', 'vista previa', 'ir a', 'saltar a',
  // portugués
  'proximo', 'proxima', 'voltar', 'mais', 'ver mais', 'mostrar mais', 'carregar mais', 'recolher', 'detalhes', 'pesquisar', 'fechar', 'baixar',
  // francés
  'suivant', 'precedent', 'retour', 'plus', 'voir plus', 'afficher plus', 'charger plus', 'developper', 'reduire', 'afficher', 'voir', 'ouvrir', 'rechercher',
  'filtrer', 'trier', 'fermer', 'telecharger',
  // alemán
  'weiter', 'zuruck', 'vorherige', 'nachste', 'mehr', 'mehr anzeigen', 'mehr laden', 'erweitern', 'ausklappen', 'einklappen', 'anzeigen', 'offnen', 'suchen',
  'filtern', 'sortieren', 'schliessen', 'herunterladen',
  // italiano
  'avanti', 'successivo', 'precedente', 'indietro', 'altro', 'mostra altro', 'carica altro', 'espandi', 'comprimi', 'mostra', 'visualizza', 'apri', 'dettagli',
  'cerca', 'filtra', 'ordina', 'chiudi', 'scarica',
  // ruso, árabe, hindi
  'далее', 'назад', 'вперед', 'еще', 'показать еще', 'показать больше', 'развернуть', 'свернуть', 'показать', 'открыть', 'подробнее', 'поиск', 'найти',
  'фильтр', 'сортировать', 'закрыть', 'скачать',
  'التالي', 'السابق', 'رجوع', 'المزيد', 'عرض المزيد', 'توسيع', 'طي', 'عرض', 'فتح', 'التفاصيل', 'بحث', 'تصفية', 'ترتيب', 'إغلاق', 'تنزيل',
  'अगला', 'पिछला', 'वापस', 'और देखें', 'विस्तार करें', 'संक्षिप्त करें', 'दिखाएं', 'खोलें', 'विवरण', 'खोजें', 'फ़िल्टर', 'क्रमबद्ध करें', 'बंद करें',
  'डाउनलोड करें',
  // chino, japonés, coreano (sin espacios: valen al principio)
  '下一页', '上一页', '下一个', '上一个', '返回', '更多', '查看更多', '加载更多', '展开', '收起', '显示', '查看', '打开', '详情', '搜索', '筛选', '排序', '关闭', '下载',
  '次へ', '前へ', '戻る', 'もっと見る', 'さらに表示', '展開', '折りたたむ', '表示', '開く', '詳細', '検索', 'フィルター', '並べ替え', '閉じる', 'ダウンロード',
  '다음', '이전', '뒤로', '더 보기', '더보기', '펼치기', '접기', '보기', '열기', '자세히', '검색', '필터', '정렬', '닫기', '다운로드'
]

/** «Cancelar», «No», «Cerrar», «Atrás»…: nunca piden permiso (salvo que su dirección sea peligrosa). */
export const SAFE_EXACT = [
  'cancel', 'cancelar', 'no', 'close', 'cerrar', 'not now', 'ahora no', 'dont allow', 'do not allow', 'no permitir', 'deny', 'denegar',
  'never', 'nunca', 'later', 'mas tarde', 'back', 'atras', 'go back', 'volver', 'keep editing', 'seguir editando', 'stay on page',
  'quedarse', 'dismiss dialog', 'no thanks', 'no gracias', 'maybe later', 'skip', 'omitir', 'decline cookies', 'reject all',
  'rechazar todo', 'rechazar todas', 'only necessary', 'solo necesarias', 'necessary only', 'reject', 'x',
  // demás idiomas
  'nao', 'fechar', 'voltar', 'agora nao', 'nao permitir', 'annuler', 'non', 'fermer', 'retour', 'pas maintenant', 'ne pas autoriser',
  'abbrechen', 'nein', 'schließen', 'zurück', 'nicht jetzt', 'nicht zulassen', 'annulla', 'chiudi', 'indietro', 'non ora', 'non consentire',
  '取消', '否', '关闭', '返回', 'キャンセル', 'いいえ', '閉じる', '戻る', '취소', '아니요', '닫기', '뒤로', 'отмена', 'нет', 'закрыть', 'назад',
  'إلغاء', 'لا', 'إغلاق', 'رجوع', 'रद्द करें', 'नहीं', 'बंद करें', 'वापस'
]

/** Botones genéricos que, en una página con contraseña, suelen enviar el inicio de sesión. */
export const PROCEED_LABELS = [
  '', 'continue', 'next', 'ok', 'okay', 'go', 'enter', 'submit', 'done', 'sign in', 'log in', 'login', 'signin', 'verify', 'confirm',
  'proceed', 'accept', 'siguiente', 'continuar', 'aceptar', 'entrar', 'acceder', 'ingresar', 'iniciar', 'enviar', 'confirmar',
  'verificar', 'listo', 'hecho', 'seguir'
]

/** «Sí», «Aceptar», «Continuar»…: dentro de un diálogo heredan el peligro de su texto. */
export const CONFIRM_EXACT = [
  'ok', 'okay', 'yes', 'si', 'confirm', 'confirmar', 'continue', 'continuar', 'proceed', 'aceptar', 'de acuerdo', 'go', 'ir', 'do it',
  'hazlo', 'sure', 'claro', 'yes continue', 'si continuar', 'done', 'listo', 'yes im sure', 'yes i m sure', 'si estoy seguro',
  'si estoy segura', 'i understand', 'entiendo', 'got it', 'entendido', 'next', 'siguiente',
  'sim', 'oui', 'confirmer', 'continuer', 'valider', 'ja', 'bestätigen', 'weiter', 'fortfahren', 'conferma', 'continua', 'procedi',
  '确定', '确认', '是', '继续', 'はい', '確認', '続ける', '続行', '확인', '예', '네', '계속', 'да', 'подтвердить', 'продолжить', 'ок',
  'نعم', 'تأكيد', 'متابعة', 'موافق', 'हाँ', 'हां', 'पुष्टि करें', 'जारी रखें', 'ठीक है'
]
export const CONFIRM_PREFIXES = ['yes', 'si', 'ok', 'okay', 'confirm', 'confirmar', 'continue', 'continuar', 'proceed',
  'oui', 'sim', 'ja', 'да', 'confirmer', 'bestatigen', 'conferma', 'continuer', 'weiter']

/** Verbos claros que cuentan aunque sean de una palabra dentro del texto de un diálogo. */
export const SENTENCE_VERBS = [
  'submit', 'resubmit', 'entregar', 'delete', 'remove', 'eliminar', 'borrar', 'quitar', 'discard', 'descartar', 'erase', 'send', 'enviar',
  'post', 'publish', 'publicar', 'reply', 'responder', 'pay', 'pagar', 'buy', 'comprar', 'purchase', 'start', 'begin', 'resume', 'retake',
  'comenzar', 'empezar', 'reanudar', 'allow', 'permitir', 'unenroll', 'withdraw', 'logout', 'unsubscribe', 'upload', 'subir', 'install',
  'instalar', 'authorize', 'autorizar', 'redeem', 'canjear', 'quit'
]

export const FILLERS = ['yes', 'si', 'ok', 'okay', 'please', 'por favor', 'click to', 'click here to', 'haz clic para',
  'pulsa para', 'toca para', 'button', 'boton', 'i want to', 'quiero', 'tap to']

export const DELETE_EXCLUSIONS = ['filter', 'filters', 'filtro', 'filtros', 'search', 'busqueda', 'selection', 'seleccion',
  'formatting', 'formato', 'sort', 'orden', 'highlight', 'resaltado']

export const START_VERBS = ['start', 'begin', 'resume', 'retake', 'take', 'launch', 'attempt', 'continue', 'restart',
  'comenzar', 'empezar', 'iniciar', 'realizar', 'reanudar', 'rendir', 'presentar', 'continuar', 'rehacer', 'repetir',
  'comecar', 'fazer', 'refazer', 'commencer', 'demarrer', 'passer', 'effectuer', 'lancer', 'inizia', 'iniziare',
  'avvia', 'esegui', 'tenta', 'riprendi', 'начать', 'пройти', 'возобновить', 'продолжить']

export const EXAM_NOUNS = ['quiz', 'quizzes', 'exam', 'examen', 'test', 'midterm', 'assessment', 'evaluacion', 'cuestionario',
  'prueba', 'parcial', 'intento', 'attempt', 'survey', 'encuesta', 'final',
  'teste', 'prova', 'exame', 'questionario', 'avaliacao', 'tentativa', 'questionnaire', 'evaluation',
  'tentative', 'controle', 'partiel', 'esame', 'verifica', 'tentativo', 'тест', 'экзамен', 'контрольную', 'попытку',
  'зачет', 'тестирование']

export const EXAM_LABEL_WORDS = ['exam', 'exams', 'examen', 'examenes', 'midterm', 'midterms', 'quiz', 'quizzes', 'cuestionario',
  'cuestionarios', 'test', 'tests', 'prueba', 'pruebas', 'parcial', 'parciales', 'assessment',
  'evaluacion', 'honorlock', 'proctored', 'proctorio', 'supervisado', 'supervisada',
  'prova', 'provas', 'exame', 'exames', 'teste', 'testes', 'avaliacao', 'partiel', 'controle', 'klausur',
  'prüfung', 'esame', 'verifica', 'экзамен', 'тест', 'контрольная', 'зачет', 'اختبار', 'امتحان', 'परीक्षा', 'टेस्ट']
export const EXAM_LABEL_PHRASES = ['final exam', 'examen final', 'final test']
export const EXAM_LABEL_DENSE = ['考试', '测验', '测试', '試験', 'テスト', '시험', '퀴즈']

export const STUDY_WORDS = [
  'review', 'reviews', 'repaso', 'study', 'estudio', 'guide', 'guia', 'practice', 'practica', 'sample', 'muestra', 'ejemplo', 'example',
  'examples', 'solutions', 'solution', 'soluciones', 'solucion', 'key', 'clave', 'notes', 'notas', 'apuntes', 'outline', 'esquema',
  'syllabus', 'temario', 'results', 'resultados', 'grades', 'calificaciones', 'scores', 'puntuaciones', 'feedback', 'retroalimentacion',
  'corrections', 'correcciones', 'answers', 'respuestas', 'prep', 'preparation', 'preparacion', 'video', 'videos', 'lecture', 'clase',
  'slides', 'diapositivas', 'worksheet', 'information', 'info', 'informacion', 'instructions', 'instrucciones', 'schedule', 'horario',
  'rubric', 'rubrica', 'topics', 'temas', 'coverage', 'recap', 'resumen', 'summary', 'announcement', 'anuncio', 'aviso', 'policy',
  'politica', 'reading', 'lectura', 'formula', 'formulas', 'sheet', 'hoja', 'tips', 'consejos', 'statistics', 'estadisticas',
  'revisao', 'estudo', 'resumo', 'gabarito', 'apostila', 'revision', 'corrige', 'resume',
  'wiederholung', 'lösungen', 'zusammenfassung', 'übung', 'ripasso', 'soluzioni', 'esercitazione', 'appunti',
  'повторение', 'решения', 'ответы', 'конспект', 'مراجعة', 'حلول', 'पुनरावृत्ति', 'समाधान'
]
export const STUDY_PHRASES = ['answer key', 'study guide', 'guia de estudio', 'hoja de formulas', 'formula sheet']
export const STUDY_DENSE = ['复习', '答案', '解答', '復習', '模範解答', '복습', '정답', '해설']

export const EXAM_SEGMENTS = ['quiz', 'quizzes', 'exam', 'exams', 'assessment', 'assessments', 'test', 'tests', 'attempt', 'attempts']
export const LOGOUT_SEGMENTS = ['logout', 'log_out', 'log-out', 'signout', 'sign_out', 'sign-out', 'logoff', 'log_off', 'cerrar-sesion', 'cerrar_sesion', 'saml_logout']
export const DELETE_SEGMENTS = ['delete', 'destroy', 'remove']
export const PAYMENT_SEGMENTS = ['checkout', 'payment', 'payments', 'pay', 'billing', 'purchase', 'cart']
export const UNENROLL_SEGMENTS = ['unenroll', 'self_unenrollment', 'withdraw', 'unsubscribe', 'drop_course']
export const PROCTOR_HOSTS = ['honorlock', 'proctorio', 'respondus', 'examity', 'proctoru', 'proctortrack', 'lockdownbrowser', 'examsoft']
export const RISKY_HOSTS: [string, DangerCategory][] = [['paypal.com', 'payment'], ['checkout.stripe.com', 'payment'], ['buy.stripe.com', 'payment'], ['pay.google.com', 'payment']]

export const SENSITIVE_EXACT = ['clave', 'pin', 'codigo', 'code', 'token', 'secret', 'secreto', 'nip']
export const SENSITIVE_WORDS = ['password', 'passwd', 'passcode', 'passphrase', 'contrasena', 'pin', 'cvv', 'cvc', 'csc', 'cvv2',
  'ssn', 'otp', '2fa', 'iban', 'senha', 'passwort', 'kennwort', 'пароль', 'pincode']
export const SENSITIVE_PHRASES = [
  'clave de acceso', 'clave secreta', 'tu clave', 'clave personal', 'clave', 'security code', 'codigo de seguridad', 'card number',
  'numero de tarjeta', 'credit card', 'tarjeta de credito', 'debit card', 'tarjeta de debito', 'expiration date', 'fecha de caducidad',
  'social security', 'seguro social', 'one time code', 'one time password', 'verification code', 'codigo de verificacion',
  'two factor', 'authentication code', 'codigo de autenticacion', 'access token', 'api token', 'api key', 'client secret',
  'routing number', 'account number', 'numero de cuenta', 'bank account', 'cuenta bancaria', 'recovery code', 'codigo de recuperacion',
  'mot de passe', 'code de verification', 'code de securite', 'code de confirmation', 'codigo de verificacao', 'codigo de seguranca',
  "parola d'ordine", 'codice di verifica', 'codice di sicurezza', 'bestatigungscode', 'verifizierungscode', 'sicherheitscode',
  'код подтверждения', 'код безопасности', 'كلمة المرور', 'رمز التحقق', 'पासवर्ड', 'सत्यापन कोड'
]
export const SENSITIVE_DENSE = ['密码', '密碼', '验证码', '驗證碼', 'パスワード', '暗証番号', '認証コード', '確認コード', '비밀번호', '인증번호', '인증 코드']

export const SEARCH_WORDS = ['search', 'buscar', 'busqueda', 'find', 'filter', 'filtrar', 'address', 'direccion', 'url', 'go to',
  'suche', 'suchen', 'rechercher', 'recherche', 'pesquisar', 'pesquisa', 'cerca', 'cercare', 'поиск', 'найти', 'بحث', 'खोज']
export const SEARCH_DENSE = ['搜索', '検索', '검색']
