'use strict'
const cote = require('cote')
const pm2 = require('pm2')
const pkgmgr = require('elife-pkg-mgr')
const u = require('elife-utils')


/*      understand/
 * This is the main entry point where we start.
 *
 *      outcome/
 * Load any configuration information and start the microservice.
 */
function main() {
    let conf = loadConfig()
    startSkillMicroservice(conf)
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


function startSkillMicroservice(cfg) {

    /*      understand/
     * The skill microservice (partitioned by key `everlife-skill-svc` to
     * prevent conflicting with other services.
     */
    const skillMgrSvc = new cote.Responder({
        name: 'Everlife Skill Manager Service',
        key: 'everlife-skill-svc',
    })


    /*      outcome/
     * Responds to a request for adding a new service
     * TODO: Keep Skill Registry
     * TODO: Inform Work Queue so we can get work
     */
    skillMgrSvc.on('add', (req, cb) => {
        if(!req.pkg) cb('No skill package found')
        else {
            u.showMsg(`Installing ${req.pkg}...`)
            pkgmgr.load(req.pkg, cfg.SKILL_FOLDER, (err, loc) => {
                if(err) cb(err)
                else {
                    u.showMsg(`Starting ${req.pkg}...`)
                    pm2.connect((err) => {
                        if(err) cb(err)
                        else startProcess(loc, cb)
                    })
                }
            })
        }
    })

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

main()

