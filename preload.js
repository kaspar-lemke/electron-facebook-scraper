// init address_bar

window.addEventListener('DOMContentLoaded', () => {
  ["address_bar"].forEach((id) => {
    let elm = document.getElementById(id)
    elm.value = localStorage.getItem(id)
    elm.addEventListener("change", () => {
      localStorage.setItem(id, elm.value)
    })
  })
})
