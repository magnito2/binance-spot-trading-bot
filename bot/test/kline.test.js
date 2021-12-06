const fs = require('fs');
import { CandlesRepo, addKlinesFromREST, Kline } from "../functions/utils.js";
const assert = require('assert').strict;

let obj = JSON.parse(fs.readFileSync('../settings.json', 'utf8'));

describe('CandlesRepo Class', function(){
    beforeEach(function(){
        this.kRepos = CandlesRepo(5);
    });

    describe('Check for REST functions', function(){
        before(async function(){
            const klinesFromREST = addKlinesFromREST(this.kRepos);
            await klinesFromREST(obj);
        });

        it('maintains size of repo', function(){
            assert.strictEqual(this.kRepos.length(), 5);
        })
    });

    it('adds a kline')
});