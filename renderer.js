const { ipcRenderer } = require('electron')

// go to your wordpress admin
let goToAddress = () => {
    ipcRenderer.send("goToAddress", document.getElementById("address_bar").value)
}

// init some form values
ipcRenderer.on("init", (event, data) => {
    let nope = x => x
    let storageHandler = () => {
        let value = localStorage.getItem("facebookEventsAddress")
        ipcRenderer.send("changedParams", { id: "facebookEventsAddress", value: value })
        return value
    }

    [
        { id: "electronDebugPort", fu: nope },
        { id: "chromeSpawnBrowserName", fu: nope },
        { id: "chromeSpawnCliCommandParams", fu: nope },
        { id: "facebookEventsAddress", fu: storageHandler }
    ].forEach((obj) => {
        let elm = document.getElementById(obj.id)
        elm.value = obj.fu(data[obj.id])
        elm.addEventListener("change", () => {
            ipcRenderer.send("changedParams", { id: elm.id, value: elm.value })
            if (obj.id == "facebookEventsAddress") {
                localStorage.setItem(obj.id, elm.value)
            }
        })
    })
    document.getElementById("Go").disabled = false
})