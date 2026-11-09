// Tema claro/oscuro: compartido entre el layout (servidor) y ThemeToggle (cliente).
export const THEME_KEY = "bar.theme";

/** Se inyecta en el <head>: aplica el tema guardado antes de pintar (sin parpadeo) */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
