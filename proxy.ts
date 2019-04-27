import * as express from 'express'
import * as Loki from 'lokijs'
import * as https from 'https'
import * as fs from 'fs'

const tileServer = 'tile.opentopomap.org' // 'tile.openstreetmap.org'

// https://www.reddit.com/r/node/comments/avy17m/async_with_https_streams/
const httpsGet = (url: string) =>
  new Promise<any>((resolve, reject) =>
    https.get(url, resolve).on('error', reject));

// https://stackoverflow.com/a/22907134/3746788
const download = async (url: string, dest: string): Promise<any> =>
  httpsGet(url)
    .then(response =>
      new Promise<any>((resolve, reject) => {
        const file = fs.createWriteStream(dest)
        response.pipe(file)
        file.on('close', () => resolve(response))
        file.on('finish', () => file.close())
        file.on('error', reject)
      }))
    .catch(error => {
      fs.unlink(dest, (_) => { }) // delete the file async (but we don't check the result)
      return error
    })

// Database
const db = new Loki('tile-db.json', { persistenceMethod: 'fs' })
const loadCollection = (colName: string): Loki.Collection<any> => {
  return db.getCollection(colName) || db.addCollection(colName)
}

// Debug
const debug = 1
const log = (...args: any[]) => {
  if (debug > 0)
    console.log(...args)
}

// Web app
const app = express()
app.get('/:s(a|b|c)/:z(\\d{1,2})/:x(\\d+)/:y(\\d+).png', (appRequest, appResponse) => {
  try {
    const sendFile = (filename: string, mimetype: string) => {
      appResponse.setHeader('Content-Type', mimetype)
      fs.createReadStream(filename).pipe(appResponse)
    }
    const { s, x, y, z } = appRequest.params
    log('processing request with params:', s, z, x, y)
    const col = loadCollection('tiles')
    const result = col.findOne({ x: x, y: y, z: z })
    log('search in db:', result)
    if (result) sendFile(result.filename, result.mimetype)
    else { // tile not found in db
      // download tile from tile server
      const url = `https://${s}.${tileServer}/${z}/${x}/${y}.png`
      const filename = `tiles/${z}-${x}-${y}.png`
      const saveInDbAndSendFile = async (headers: object) => {
        const mimetype = headers['content-type']
        log(col.insert({
          x: x, y: y, z: z,
          filename: filename,
          mimetype: mimetype
        }))
        db.saveDatabase()
        sendFile(filename, mimetype)
      }
      log('downloading tile to', filename, 'from', url)
      download(url, filename)
        .then(response => saveInDbAndSendFile(response.headers))
        .catch(error => { // error downloading file
          console.log(error)
          appResponse.sendStatus(400)
        })
    }
  } catch (error) { // error with db or reading the file from fs?
    console.log(error)
    appResponse.sendStatus(400)
  }
})

const port = 3001
app.listen(port)

