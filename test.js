'use strict'
const cote = require('cote')
const client = new cote.Requester({
    name: 'Test SkillMgr Client',
    key: 'everlife-skill-svc',
})

/*      outcome/
 * Simple add skill test
 */
function main() {
    client.send({ type: 'add', pkg: 'everlifeai/elife-utils' })
}

main()
