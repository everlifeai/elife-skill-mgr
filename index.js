'use strict'
const cote = require('cote')({statusLogsEnabled:false})
const pm2 = require('@elife/pm2')
const pkgmgr = require('@elife/pkg-mgr')
const u = require('@elife/utils')
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
    startSkillsInFolders(conf, u.showMsg, u.showErr, ()=> {
        startSkillMicroservice(conf)
        registerWithCommMgr(conf)
    })
    shutdownChildren()
}

function shutdownChildren() {
    process.once('SIGINT', stop_1)
    process.once('SIGTERM', stop_1)

    function stop_1() {
        pm2.forEach(pi => {
            if(pi.name && pi.child) u.showMsg(`Stopping ${pi.name} (pid: ${pi.child.pid})`)
            pm2.stop(pi)
        })
        process.exit()
    }
}


/*      outcome/
 * Load the configuration (from environment variables) or defaults
 */
function loadConfig() {
    let cfg = {};
    if(process.env.SKILL_FOLDER) {
        cfg.SKILL_FOLDER = process.env.SKILL_FOLDER;
    } else {
        cfg.SKILL_FOLDER = u.skillLoc()
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

        let pkg = m[1]
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
    stopProcess(pkg,(err) => {
        pkgmgr.installLatest(pkg, cfg.SKILL_FOLDER, (err, loc) => {
            if(err) cb(err)
            else {
                saveToSSB(loc, (err) => {
                    if(err) u.showErr(err)
                    else {
                        o(`Starting ${loc}...`)
                        startProcess(loc, cb)
                    }
                })
            }
        })
    })
}

/*      understand/
 * The ssb microservice for storing ssb messages
 */
let ssb = new cote.Requester({
    name: 'SkillMgr -> SSB',
    key: 'everlife-ssb-svc',
})

/*      outcome/
 * Use the ssb microservice to save our installed skills
 */
function saveToSSB(pkg, cb) {
    ssb.send({
        type: 'new-msg',
        msg: { type: 'install-skill', pkg: pkg },
    }, cb)
}

function startProcess(cwd, cb) {
    let name = path.basename(cwd)
    let lg = path.join(u.logsLoc(), `${name}.log`)
    let opts = {
        name: name,
        script: "index.js",
        cwd: cwd,
        log: lg,
        stripANSI:true,
    }
    pm2.start(opts, cb)
}

function stopProcess(pkg, cb) {
    let cwd = pkgmgr.normalize(pkg)
    pm2.stop(cwd.name, cb)
}

/**
 *      situation/
 * We have two skill folders -
 *  (1) A set of 'core' skills released by Everlife
 *      (found in the sub-directory ./skills)
 *  (2) User downloaded skills
 *      (found in the user skill directory)
 *
 *      problem/
 * We would like to load all core and user skills allowing the user to
 * over-ride any core skill that they want (user skills take
 * precedence).
 *
 *      way/
 * We walk the core skill directory and the user skill directory and
 * discard any duplicate skills from the core directory. Then we upgrade
 * and start all the skill folders available.
 */
function startSkillsInFolders(cfg, o, e, cb){

    const CORE_SKILL_DIR = path.join(__dirname, 'skills')

    fs.readdir(CORE_SKILL_DIR, (err, core_files) => {
        if(err) e(err)
        else fs.readdir(cfg.SKILL_FOLDER, (err, user_files) => {
            if(err) e(err)
            else {
                core_files = discard_duplicates(user_files, core_files)
                let files = []
                files = files.concat(make_full_paths_1(CORE_SKILL_DIR, core_files))
                files = files.concat(make_full_paths_1(cfg.SKILL_FOLDER, user_files))

                handle_file_ndx_1(files, 0)
            }
        })
    })

    function discard_duplicates(user_files, core_files) {
        return core_files.filter((f) => {
            for(let i = 0;i < user_files.length;i++) {
                if(f == user_files[i]) return false
            }
            return true
        })
    }

    function make_full_paths_1(root, files) {
        return files.map((f) => path.join(root, f))
    }

    function handle_file_ndx_1(files, ndx) {
        if(ndx >= files.length) {
            cb()
            return
        }
        let file = files[ndx]
        fs.lstat(file, (err, stat) => {
            if(!err && stat.isDirectory()) {
                just_start_1(file, (err) => {
                    if(err) e(err)
                    handle_file_ndx_1(files, ndx+1)
                })
            } else {
                handle_file_ndx_1(files, ndx+1)
            }
        })
    }

    /*      outcome/
     * Don't upgrade and start - git and yarn
     * failing on windows OS
     */
    function just_start_1(loc, cb) {
        o(`Starting ${loc}...`)
        startProcess(loc, cb)
    }

    function upgrade_and_start_1(loc, cb) {
        pkgmgr.update(loc, (err) => {
            if(err) e(err)
            o(`Starting ${loc}...`)
            startProcess(loc, cb)
        })
    }
}

main()
