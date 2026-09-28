// Menú "Más" (celular): accesos a las pantallas secundarias.

export async function render(el) {
  el.innerHTML = `
    <h1>Más</h1>
    <ul class="tarjeta lista-enlaces" style="padding:0">
      <li><a href="#/categorias">Categorías</a></li>
      <li><a href="#/hermanos">Hermanos</a></li>
      <li><a href="#/configuracion">Configuración</a></li>
    </ul>`;
}
