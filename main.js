const { app, BrowserWindow, BrowserView } = require('electron')
const path = require('path')
const fetch = require('node-fetch')
const puppeteer = require('puppeteer')
const { ipcMain } = require('electron')
const { session } = require('electron')
const { spawn } = require('child_process');

// default debug-port
let debugPort = 8315

/**
 * you can try changing the debug-port with a start command like this:
 * ./node_modules/.bin/electron . ---ppport=8318
 */
try {
  debugPort = process.argv.filter(x => x.match(/ppport/))[0].match(/-*ppport=(\d+)/)[1]
} catch (err) {
  // console.log(err)
}

// this is the only time to set the debugport
app.commandLine.appendSwitch('remote-debugging-port', debugPort)

// some global variables for protection from the garbage collector
let mainWindow, puppElecChromWindow, view, mainFormValues, spanHandler

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1550,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true
    }
  })

  mainWindow.loadFile('index.html')

  view = new BrowserView({ webPreferences: { nodeIntegration: true } })
  mainWindow.setBrowserView(view)
  view.setBounds({ x: 0, y: 160, width: 1400, height: 600 })
  view.setAutoResize({ width: true, height: true })

  ipcMain.on("goToAddress", (event, msg) => {
    view.webContents.loadURL(msg).catch((err) => {
      sendErrorMessage(err)
    })
  })

  mainWindow.on('closed', function () {
    mainWindow = null
    if (puppElecChromWindow) {
      puppElecChromWindow.close()
    }
    view = null
  })

  mainWindow.webContents.once("did-finish-load", () => {
    mainFormValues = {
      electronDebugPort: debugPort,
      chromeSpawnBrowserName: "google-chrome",
      chromeSpawnCliCommandParams: "--headless --disable-gpu --remote-debugging-port=9222",
      facebookEventsAddress: null
    }
    mainWindow.webContents.send("init", mainFormValues)
  })
}

ipcMain.on("changedParams", (event, data) => {
  mainFormValues[data.id] = data.value
})

ipcMain.on("startPuppeteerWithElectron", (event, msg) => {
  if (puppElecChromWindow) {
    puppElecChromWindow.close()
  }
  if (spanHandler) {
    spanHandler.kill()
  }
  view.webContents.send("clear_displays", "just trigger")

  // puppeteer will connect via the debug-port with an electron window
  if (msg.browser == "electron") {
    puppElecChromWindow = new BrowserWindow({
      x: -200,
      y: 200,
      minWidth: 1024,
      minHeight: 768,
      show: msg.show
    })

    puppElecChromWindow.on('closed', function () {
      sendProcessMessage("puppElecChromWindow wurde geschlossen")
      puppElecChromWindow = null
    })

    puppElecChromWindow.loadFile('puppElecChromWindow.html')

    puppElecChromWindow.webContents.once("did-finish-load", () => {
      sendProcessMessage("once => puppElecChromWindow => did-finish-load")
      scraper(debugPort, "puppElecChromWindow")
    })
    // will start a chrome window to connect to puppeteer
  } else if (msg.browser == "chrom") {
    let scrapeOnce = () => {
      scraper(mainFormValues.chromeSpawnCliCommandParams.split("port=")[1], "xxxxx")
      scrapeOnce = () => { }
    }
    sendProcessMessage(`try to spawn with ${mainFormValues.chromeSpawnBrowserName} ${mainFormValues.chromeSpawnCliCommandParams}`)
    spanHandler = spawn(mainFormValues.chromeSpawnBrowserName, [mainFormValues.chromeSpawnCliCommandParams], {
      shell: true,
      detached: true
    })
    spanHandler.stderr.on('data', (data) => {
      sendErrorMessage(`stderr => ${data}`)
      scrapeOnce()
    });
    spanHandler.stdout.on('data', (data) => {
      sendProcessMessage(`stdout => ${data}`)
      scrapeOnce()
    });
  }

  // scrape every upcoming event
  let scraper = (port, pageTitle) => {
    (async () => {
      try {
        let page = await getEventPage(port, pageTitle)
        sendProcessMessage("event-page ready")

        session.defaultSession.webRequest.onCompleted({ urls: ['https://*'] }, (details, callback) => {
          sendRequestMessage("request => " + details.url)
        })

        let eventCountBeforeScroll, eventCountAfterScroll
        do {
          eventCountBeforeScroll = await page.evaluate(() => document.querySelectorAll("#upcoming_events_card a[href^='/events']").length)
          await page.evaluate(() => { window.scrollBy(0, 500) })
          sendProcessMessage("action => scroll")
          await page.waitFor(500)
          eventCountAfterScroll = await page.evaluate(() => document.querySelectorAll("#upcoming_events_card a[href^='/events']").length)
        } while ((eventCountBeforeScroll != eventCountAfterScroll) || (eventCountAfterScroll == 0))
        let eventRefs = await page.evaluate(() => {
          return Array.from(document.querySelectorAll("#upcoming_events_card a[href^='/events']")).map((el) => el.getAttribute("href"))
        })

        let eventdata = await (async () => {
          let data = []
          for (let i = 0; i < eventRefs.length; i++) {
            let locationOrigin = await page.evaluate(() => location.origin)
            await page.goto(locationOrigin + eventRefs[i], { waitUntil: 'networkidle2' })
            await page.waitForSelector("div[data-testid='event-permalink-details']")
            sendProcessMessage(`Event page number ${i} is loaded`)
            let eventRef = eventRefs[i].split("?")[0]
            data.push(
              await page.evaluate((eventRef) => {
                let recWalker = (node) => {
                  let valuesFlat = []
                  for (let item of node.childNodes) {
                    if (item.nodeValue && item.nodeValue.match(/[^\s]/)) {
                      valuesFlat.push(item.nodeValue.trim().replace(/(\r\n|\r|\n|   +)/g, ' '))
                    }
                    if (item.childNodes) {
                      if (true) {
                        valuesFlat = valuesFlat.concat(recWalker(item))
                      }
                    }
                  }
                  return valuesFlat
                }
                return {
                  eventName: document.querySelector("*[data-testid='event-permalink-event-name']").innerText,
                  privacy: document.querySelector("*[data-testid='event_permalink_privacy']").innerText,
                  feature_line: document.querySelector("*[data-testid='event_permalink_feature_line']").innerText,
                  details: document.querySelector("*[data-testid='event-permalink-details']").innerText,
                  event_summary: recWalker(document.getElementById("event_summary")),
                  event_url: location.origin + eventRef
                }
              }, eventRef)
            )
          }
          return data
        })()
        view.webContents.send("send_data", eventdata)
        if (spanHandler) {
          spanHandler.kill()
        }
      } catch (err) {
        sendErrorMessage(err)
      }
    })()
  }
})

// before we go to event-page we have to find the debug-endpoint
let getEventPage = (port, pageTitle) => {
  sendProcessMessage("try to find debugEndpoints")
  return fetch(`http://localhost:${port}/json/list?nocache=${Date.now()}`)
    .then((response) => response.json())
    .then((debugEndpoints) => {
      if (debugEndpoints.length == 0) { sendErrorMessage("no debugEndpoints found") }
      sendProcessMessage(`${debugEndpoints.length} debugEndpoints found`)
      let webSocketDebuggerUrl = ''
      for (const debugEndpoint of debugEndpoints) {
        if (debugEndpoint.title === pageTitle || debugEndpoints.length == 1) {
          webSocketDebuggerUrl = debugEndpoint.webSocketDebuggerUrl
          sendProcessMessage(`pageTitle => ${debugEndpoint.title}`)
          break
        }
      }
      sendProcessMessage(`webSocketDebuggerUrl => ${webSocketDebuggerUrl}`)
      return puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl })
    })
    .then((browser) => {
      if (browser) {
        sendProcessMessage("connection to puppeteer successful")
      } else {
        sendErrorMessage("connection to puppeteer failed")
      }
      return browser.pages()
    })
    .then((pages) => {
      return new Promise((resolve, reject) => {
        pages.forEach(async (page, i) => {
          let title = await page.title()
          if (title == "puppElecChromWindow" || pages.length == 1) {
            resolve(page)
          }
        })
      })
    })
    .then((page) => {
      sendProcessMessage(`goto => ${mainFormValues.facebookEventsAddress}`)
      return page.goto(mainFormValues.facebookEventsAddress).then(() => page)
    })
    .catch((err) => {
      sendErrorMessage(err)
    })
}
let sendMessage = (on, m, color) => {
  try {
    view.webContents.send(on, (() => {
      let msg
      if (m.message) {
        msg = m.message
      } else {
        msg = "" + m
      }
      return { msg: msg, color: color }
    })())
  } catch (err) {
    // console.log(err)
  }
}
let sendErrorMessage = (err) => {
  sendMessage("send_message", err, "red")
}
let sendProcessMessage = (pr) => {
  sendMessage("send_message", pr, "#808080")
}
let sendRequestMessage = (rq) => {
  sendMessage("send_request_message", rq, "#808080")
}

app.on('ready', createWindow)

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', function () {
  if (mainWindow === null) createWindow()
})