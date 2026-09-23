"""Crash-safe, process-safe EUR reservation ledger. All amounts are micro-EUR.

No network access. Quotes must include tax, FX and other incremental charges.
Unknown outcomes retain their whole reservation. No implicit refunds or retries.
"""
import json
import sqlite3
import sys

CAP = 1_000_000


def amount(value):
    if type(value) is not int or not 0 <= value <= CAP:
        raise ValueError('INVALID_MICRO_EUR')
    return value


def execute(path, action, p):
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    db.execute('PRAGMA synchronous=FULL')
    db.execute('BEGIN IMMEDIATE')
    try:
        db.execute('CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS spend (key TEXT PRIMARY KEY, stage TEXT NOT NULL, reserved INTEGER NOT NULL, actual INTEGER, receipt TEXT, overrun INTEGER NOT NULL DEFAULT 0)')
        db.execute('CREATE TABLE IF NOT EXISTS checkpoints (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        row = db.execute('SELECT value FROM config WHERE id=1').fetchone()
        if action == 'init':
            amount(p['cap_micro_eur'])
            if p['cap_micro_eur'] <= 0 or not p.get('run_id'):
                raise ValueError('RUN_AND_POSITIVE_CAP_REQUIRED')
            canonical = json.dumps(p, sort_keys=True)
            if row and row[0] != canonical:
                raise ValueError('CONFIG_IMMUTABLE')
            db.execute('INSERT OR IGNORE INTO config VALUES (1,?)', (canonical,))
            row = (canonical,)
        if not row:
            raise ValueError('BUDGET_NOT_INITIALIZED')
        config = json.loads(row[0])
        if p.get('run_id', config['run_id']) != config['run_id']:
            raise ValueError('RUN_MISMATCH')
        used = db.execute('SELECT COALESCE(SUM(COALESCE(actual,reserved)),0) FROM spend').fetchone()[0]
        if action == 'reserve':
            quoted = amount(p['upper_micro_eur'])
            if not p.get('key') or not p.get('stage'):
                raise ValueError('KEY_AND_STAGE_REQUIRED')
            if db.execute('SELECT 1 FROM spend WHERE overrun=1').fetchone():
                raise ValueError('COST_OVERRUN_HALTED')
            if db.execute('SELECT 1 FROM spend WHERE key=?', (p['key'],)).fetchone():
                raise ValueError('ALREADY_RESERVED_NO_RESUBMIT')
            if used + quoted > config['cap_micro_eur']:
                raise ValueError('EUR_BUDGET_EXHAUSTED')
            db.execute('INSERT INTO spend(key,stage,reserved) VALUES (?,?,?)', (p['key'],p['stage'],quoted))
        elif action == 'settle':
            actual = p['actual_micro_eur']
            if type(actual) is not int or actual < 0:
                raise ValueError('INVALID_ACTUAL')
            if not p.get('receipt'):
                raise ValueError('PROVIDER_RECEIPT_REQUIRED')
            entry = db.execute('SELECT reserved,actual,receipt FROM spend WHERE key=?', (p['key'],)).fetchone()
            if not entry:
                raise ValueError('RESERVATION_REQUIRED')
            if entry[1] is not None and (entry[1] != actual or entry[2] != p['receipt']):
                raise ValueError('SETTLEMENT_CONFLICT')
            db.execute('UPDATE spend SET actual=?,receipt=?,overrun=? WHERE key=?', (actual,p['receipt'],int(actual>entry[0]),p['key']))
        elif action == 'checkpoint':
            encoded = json.dumps(p['value'], sort_keys=True)
            old = db.execute('SELECT value FROM checkpoints WHERE key=?',(p['key'],)).fetchone()
            if old and old[0] != encoded:
                raise ValueError('CHECKPOINT_CONFLICT')
            db.execute('INSERT OR IGNORE INTO checkpoints VALUES (?,?)',(p['key'],encoded))
        elif action not in ('init','status'):
            raise ValueError('UNKNOWN_ACTION')
        result = {'config':config,'stages':{},'checkpoints':[], 'halted':False}
        for stage, confirmed, unresolved, n in db.execute('SELECT stage,COALESCE(SUM(actual),0),COALESCE(SUM(CASE WHEN actual IS NULL THEN reserved ELSE 0 END),0),COUNT(*) FROM spend GROUP BY stage'):
            result['stages'][stage]={'settled_micro_eur':confirmed,'unresolved_micro_eur':unresolved,'requests':n}
        result['committed_micro_eur']=sum(s['settled_micro_eur']+s['unresolved_micro_eur'] for s in result['stages'].values())
        result['remaining_micro_eur']=max(0,config['cap_micro_eur']-result['committed_micro_eur'])
        result['halted']=bool(db.execute('SELECT 1 FROM spend WHERE overrun=1').fetchone())
        result['checkpoints']=[json.loads(r[0]) for r in db.execute('SELECT value FROM checkpoints ORDER BY rowid')]
        db.execute('COMMIT')
        return result
    except Exception:
        db.execute('ROLLBACK')
        raise
    finally:
        db.close()


if __name__ == '__main__':
    try:
        print(json.dumps(execute(sys.argv[1],sys.argv[2],json.load(sys.stdin))))
    except Exception as exc:
        # Do not echo payloads, credentials or SQL errors containing user data.
        error = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
        print(json.dumps({'error':error}))
        raise SystemExit(1)
