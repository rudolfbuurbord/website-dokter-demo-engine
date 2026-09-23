import importlib.util
from pathlib import Path
import unittest
import json
import urllib.error

spec = importlib.util.spec_from_file_location('preflight', Path(__file__).parents[1] / 'deploy/preflight-budget-test.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class PreflightTest(unittest.TestCase):
    def test_no_generation_or_database_mutation_and_no_secret_output(self):
        calls = []
        def fetch(url, headers=None, payload=None):
            calls.append((url, payload))
            if 'supabase' in url:
                self.assertEqual(payload, {'p_action': 'status', 'p_payload': {}})
                return b'{"runs": []}'
            if 'openai' in url:
                self.assertIn('/v1/models/', url)
                self.assertIsNone(payload)
                return json.dumps({'id': p.MODEL}).encode()
            self.assertIsNone(headers)
            return b'<rss><channel><item><title>Schildersbedrijf Test</title><link>https://test.nl</link></item></channel></rss>'
        report = p.preflight({'SUPABASE_URL': 'https://' + p.PROJECT_HOST,
                              'SUPABASE_SERVICE_ROLE_KEY': 'secret-db', 'OPENAI_API_KEY': 'secret-model'}, fetch)
        self.assertEqual(len(calls), 3)
        self.assertEqual(report['checks']['database'], 'OK')
        self.assertEqual(report['checks']['public_search_probe'], 'RESULTS_RECEIVED')
        self.assertNotIn('secret-', json.dumps(report))
        self.assertFalse(report['test_started'])

    def test_failures_are_independent_and_redacted(self):
        calls = []
        def fetch(url, headers=None, payload=None):
            calls.append(url)
            raise RuntimeError('secret-model: must never appear')
        report = p.preflight({'SUPABASE_URL': 'https://' + p.PROJECT_HOST,
                              'SUPABASE_SERVICE_ROLE_KEY': 'key', 'OPENAI_API_KEY': 'key'}, fetch)
        self.assertEqual(len(calls), 3)
        self.assertNotIn('secret-model', json.dumps(report))
        self.assertEqual(report['checks']['database'], 'FAILED_RuntimeError')

    def test_no_credentials_sent_to_wrong_project(self):
        calls = []
        def fetch(url, headers=None, payload=None):
            calls.append(url)
            return b'<rss><channel /></rss>'
        report = p.preflight({'SUPABASE_URL': 'https://wrong.example', 'SUPABASE_SERVICE_ROLE_KEY': 'key'}, fetch)
        self.assertEqual(len(calls), 1)
        self.assertEqual(report['checks']['database'], 'EXPECTED_PROJECT_CONFIG_REQUIRED')

    def test_challenge_is_not_a_search_result(self):
        with self.assertRaises((ValueError, p.ET.ParseError)):
            p.search_candidates(b'<html><body>CAPTCHA</body></html>')
        with self.assertRaises(ValueError):
            p.search_candidates(b'<!DOCTYPE rss><rss />')

    def test_dedupe_and_irrelevant_results(self):
        raw = b'<rss><channel><item><title>Schilders</title><link>https://www.test.nl/a</link></item><item><title>Schilders</title><link>https://test.nl/b</link></item><item><title>Other topic</title><link>https://other.nl/</link></item></channel></rss>'
        self.assertEqual(len(p.search_candidates(raw)), 1)


if __name__ == '__main__':
    unittest.main()
