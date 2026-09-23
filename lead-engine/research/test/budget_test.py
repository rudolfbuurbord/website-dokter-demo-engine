import concurrent.futures
import importlib.util
import pathlib
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('ledger',pathlib.Path(__file__).parents[1]/'budget_ledger.py')
ledger=importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)


class BudgetTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=str(pathlib.Path(self.tmp.name)/'budget.sqlite')
        self.call('init',{'run_id':'test','cap_micro_eur':1_000_000})
    def tearDown(self):
        self.tmp.cleanup()
    def call(self,action,p=None):
        return ledger.execute(self.path,action,p or {})
    def reserve(self,key,value):
        return self.call('reserve',{'key':key,'stage':'MODEL','upper_micro_eur':value})
    def test_concurrent_reservations_never_overspend(self):
        def spend(i):
            try:
                self.reserve(str(i),100_000)
                return True
            except ValueError as e:
                self.assertEqual(str(e),'EUR_BUDGET_EXHAUSTED')
                return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            accepted=list(pool.map(spend,range(30)))
        self.assertEqual(sum(accepted),10)
        self.assertEqual(self.call('status')['remaining_micro_eur'],0)
    def test_unknown_outcome_survives_reopen(self):
        self.reserve('timeout',900_000)
        self.assertEqual(self.call('status')['committed_micro_eur'],900_000)
        with self.assertRaisesRegex(ValueError,'ALREADY_RESERVED'):
            self.reserve('timeout',900_000)
        with self.assertRaisesRegex(ValueError,'BUDGET_EXHAUSTED'):
            self.reserve('other',100_001)
    def test_settlement_idempotence_and_no_false_refund(self):
        self.reserve('one',500_000)
        p={'key':'one','actual_micro_eur':100_000,'receipt':'provider-1'}
        self.call('settle',p)
        self.call('settle',p)
        self.assertEqual(self.call('status')['committed_micro_eur'],100_000)
        with self.assertRaisesRegex(ValueError,'SETTLEMENT_CONFLICT'):
            self.call('settle',{**p,'actual_micro_eur':0})
    def test_bad_quotes_stop_future_calls_but_record_real_cost(self):
        self.reserve('one',10)
        r=self.call('settle',{'key':'one','actual_micro_eur':11,'receipt':'provider-1'})
        self.assertTrue(r['halted'])
        self.assertEqual(r['committed_micro_eur'],11)
        with self.assertRaisesRegex(ValueError,'COST_OVERRUN_HALTED'):
            self.reserve('two',1)
    def test_cannot_raise_budget_or_change_run_on_restart(self):
        with self.assertRaisesRegex(ValueError,'CONFIG_IMMUTABLE'):
            self.call('init',{'run_id':'other','cap_micro_eur':1_000_000})
        for value in (1_000_001, -1, 0.5, True):
            with self.assertRaises(ValueError):
                self.call('init',{'run_id':'test','cap_micro_eur':value})
    def test_checkpoint_replay_and_conflicts(self):
        p={'key':'task:1','value':{'company_id':'c','status':'REVIEW'}}
        self.call('checkpoint',p)
        self.call('checkpoint',p)
        self.assertEqual(len(self.call('status')['checkpoints']),1)
        with self.assertRaisesRegex(ValueError,'CHECKPOINT_CONFLICT'):
            self.call('checkpoint',{**p,'value':{'status':'APPROVED'}})


if __name__=='__main__':
    unittest.main()
