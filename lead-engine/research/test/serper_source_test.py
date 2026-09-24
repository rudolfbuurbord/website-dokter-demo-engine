import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('source',Path(__file__).parents[1]/'serper-source.py')
source=importlib.util.module_from_spec(spec); spec.loader.exec_module(source)

class SourceTest(unittest.TestCase):
    def test_directory_duplicates_and_irrelevant_results(self):
        rows=[{'title':'Schilderbedrijf','link':u} for u in ['https://trustoo.nl/x','https://www.example.nl/contact','https://example.nl/','https://user:password@example.com/','file:///etc/passwd']]
        rows.append({'title':'Restaurant','link':'https://restaurant.nl/'})
        result=source.candidates({'organic':rows},'schildersbedrijf Enschede',2,'2026-09-24')
        self.assertEqual([r['domain'] for r in result],['example.nl'])
        self.assertEqual(result[0]['source_url'],'https://www.example.nl/contact')
        self.assertNotIn('company_name',result[0])
    def test_limits_and_no_position_fabrication(self):
        rows=[{'title':'Schilder','link':f'https://schilder{i}.nl/'} for i in range(20)]
        result=source.candidates({'organic':rows},'q',3,'now')
        self.assertEqual(len(result),10)
        self.assertIsNone(result[0]['provider_position'])
    def test_secret_redirect_refused(self):
        with self.assertRaises(RuntimeError): source.NoRedirect().redirect_request(None,None,None,None,None,None)

if __name__=='__main__': unittest.main()
