'use strict'
const cote = require('cote')({statusLogsEnabled:false})
const pm2 = require('pm2')
const pkgmgr = require('elife-pkg-mgr')
const u = require('elife-utils')
const path = require('path')
const fs = require('fs')


/*      understand/
 * This is the main entry point where we start.
 *
 *      outcome/
 * Load any configuration information, start existing skills,
 * start the microservice and register for commands with the
 * communication manager.
 */
function main() {
    let conf = loadConfig()
    startSkillsInFolder(conf, u.showMsg, u.showErr, ()=> {
        startSkillMicroservice(conf)
        registerWithCommMgr(conf)
    })
}

/*      outcome/
 * Load the configuration (from environment variables) or defaults
 */
function loadConfig() {
    let cfg = {};
    if(process.env.SKILL_FOLDER) {
        cfg.SKILL_FOLDER = process.env.SKILL_FOLDER;
    } else {
        cfg.SKILL_FOLDER = "./skills";
    }
    return cfg;
}


const commMgrClient = new cote.Requester({
    name: 'SkillMgr -> CommMgr',
    key: 'everlife-communication-svc',
})

function sendReply(msg, req) {
    req.type = 'reply'
    req.msg = msg
    commMgrClient.send(req, (err) => {
        if(err) u.showErr(err)
    })
}

let msKey = 'everlife-skill-svc'
/*      outcome/
 * Register ourselves as a message handler with the communication
 * manager so we can handle requests for installation of new skills.
 */
function registerWithCommMgr(conf) {
    commMgrClient.send({
        type: 'register-msg-handler',
        mskey: msKey,
        mstype: 'msg',
        mshelp: [ { cmd: '/install', txt: 'install a new skill' } ],
    }, (err) => {
        if(err) u.showErr(err)
    })
}

function startSkillMicroservice(cfg) {

    /*      understand/
     * The skill microservice (partitioned by key `everlife-skill-svc` to
     * prevent conflicting with other services.
     */
    const skillMgrSvc = new cote.Responder({
        name: 'Everlife Skill Manager Service',
        key: msKey,
    })

    /*      outcome/
     * Respond to user messages asking us to install new skills
     */
    skillMgrSvc.on('msg', (req, cb) => {
        if(!req.msg || !req.msg.match) return cb()

        const rx = /^\/install  *(.*)/i
        let m = req.msg.match(rx)
        if(!m) return cb()
        cb(null, true)

        let pkg = `everlifeai/${m[1]}`
        pkg = pkg.trim()
        if(!pkg) sendReply(`What should I install?`, req)
        else install(
            cfg,
            (msg) => sendReply(msg, req),
            pkg,
            (err) => {
                if(err) sendReply(`Error! ${err}`, req)
                else sendReply(`install done`, req)
            }
        )
    })


    /*      outcome/
     * Responds to a request for adding a new service
     * TODO: Keep Skill Registry
     * TODO: Inform Work Queue so we can get work
     */
    skillMgrSvc.on('add', (req, cb) => {
        if(!req.pkg) cb('No skill package found')
        else install(cfg, u.showMsg, req.pkg, cb)
    })

}

function install(cfg, o, pkg, cb) {
    o(`Installing ${pkg}...`)
    pkgmgr.load(pkg, cfg.SKILL_FOLDER, (err, loc) => {
        if(err) cb(err)
        else {
            // TODO: this may need to be in a better location
            // TODO: Check that package is not already installed
            saveToSSB(pkg, (err) => {
                if(err) u.showErr(err)
                else {
                    o(`Starting ${pkg}...`)
                    pm2.connect((err) => {
                        if(err) cb(err)
                        else startProcess(loc, cb)
                    })
                }
            })
        }
    })
}

/*      understand/
 * The queue microservice manages task queues
 */
let workq = new cote.Requester({
    name: 'SkillMgr -> Work Queue',
    key: 'everlife-workq-svc',
})
/*      outcome/
 * Use the queue microservice to properly stack messages for SSB.
 */
function saveToSSB(pkg, cb) {
    workq.send({
        type: 'q',
        q: 'everlife-ssb-svc',
        data: {
            type: 'new-msg',
            msg: { type: 'install-skill', pkg: pkg },
        },
    }, cb)
}


function startProcess(cwd, cb) {
    let name = path.basename(cwd)
    let lg = path.join(__dirname, 'logs', `${name}.log`)
    let opts = {
        name: name,
        script: "index.js",
        cwd: cwd,
        log: lg,
    }
    pm2.start(opts, cb)
}

/**
 *      outcome/
 * Upgrade and start all skill sub-folders in the skills/ directory.
 */
function startSkillsInFolder(cfg, o, e, cb){

    fs.readdir(cfg.SKILL_FOLDER, (err, files) => {
        if(err) e(err)
        else handle_file_ndx_1(files, 0)

        function handle_file_ndx_1(files, ndx) {
            if(ndx >= files.length) return
            let loc = path.join(cfg.SKILL_FOLDER, files[ndx])
            fs.lstat(loc, (err, stat) => {
                if(!err && stat.isDirectory()) {
                    upgrade_and_start_1(loc, (err) => {
                        if(err) e(err)
                        handle_file_ndx_1(files, ndx+1)
                    })
                }
                else handle_file_ndx_1(files, ndx+1)
            })
        }
    })

    function upgrade_and_start_1(loc, cb) {
        pkgmgr.update(loc, (err) => {
            if(err) e(err)
            o(`Starting ${loc}...`)
            pm2.connect((err) => {
                if(err) cb(err)
                else startProcess(loc, cb)
            })
        })
    }
}

main()
