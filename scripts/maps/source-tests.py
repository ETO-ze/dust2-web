import importlib.util
import pathlib
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location('compiler',pathlib.Path(__file__).with_name('compile-source.py'))
compiler=importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)
spec=importlib.util.spec_from_file_location('policy',pathlib.Path(__file__).with_name('build-entity-collision-policy.py'))
policy=importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)

class SourceGeometryTests(unittest.TestCase):
    def test_coordinate_conversion_preserves_floor_height(self):
        self.assertEqual(compiler.point([100,200,300]),[2.54,7.62,-5.08])
    def test_player_clip_is_not_a_bullet_wall(self):
        self.assertEqual(compiler.collision_mask({'extras':{'InteractAs':'npcclip,playerclip'}}),1)
        self.assertEqual(compiler.collision_mask({'extras':{'InteractAs':'csgo_grenadeclip'}}),4)
        self.assertEqual(compiler.collision_mask({'extras':{'InteractAs':'passbullets'}}),5)
        self.assertEqual(compiler.collision_mask({'extras':{}}),7)
    def test_conditionally_solid_layers_exclude_only_explicit_nonphysical_masks(self):
        def mask(tags):
            return compiler.collision_mask({'extras':{'CollisionGroup':'ConditionallySolid','InteractAs':tags}})
        for tags in (['npcclip'],['blocksound'],['navclip']):
            self.assertEqual(mask(tags),0)
        self.assertEqual(mask(['npcclip','playerclip']),1)
        self.assertEqual(mask(['blocksound','solid']),7)
        self.assertEqual(mask(['blocksound','window']),7)
        self.assertEqual(mask([]),7)
    def test_dynamic_props_require_explicit_matched_nonsolid_state(self):
        node={'name':'prop_dynamic','_gameOrigin':[0.,0.,0.]}
        prop={'classname':'prop_dynamic','origin':[0,0,0],'hammeruniqueid':'5','solid':'0'}
        self.assertEqual(compiler.nonsolid_prop(node,[prop])['reason'],'non-solid-prop')
        self.assertIsNone(compiler.nonsolid_prop(node,[prop,{**prop,'solid':6}]))
        self.assertIsNone(compiler.nonsolid_prop(node,[{**prop,'origin':[100,0,0]}]))
    def test_inactive_variant_collision_requires_unambiguous_source_and_no_enable_output(self):
        node={'name':'prop_dynamic','_gameOrigin':[2.54,7.62,-5.08]}
        prop={'classname':'prop_dynamic','origin':[100,200,300],'hammeruniqueid':'42','model':'resource_name:"models/props/door.vmdl"',
              'startdisabled':True,'targetname':'[PR#]props.2v2','solid':'6'}
        self.assertEqual(policy.inactive_layout_prop(node,[prop],[])['reason'],'inactive-layout-prop')
        for change in ({'startdisabled':False},{'targetname':'[PR#]vent_open'},{'origin':[120,200,300]},{'hammeruniqueid':None}):
            self.assertIsNone(policy.inactive_layout_prop(node,[{**prop,**change}],[]))
        self.assertIsNone(policy.inactive_layout_prop(node,[prop,{**prop,'startdisabled':False}],[]))
        targets=policy.enable_targets('@OnTrigger Delay=1 Enable [PR#]props.*')
        self.assertIsNone(policy.inactive_layout_prop(node,[prop],targets))
    def test_gltf_matrix_column_order_and_rotation(self):
        matrix=compiler.local_matrix({'matrix':[1,0,0,0,0,1,0,0,0,0,1,0,2,3,4,1]})
        result=compiler.ROTATE@matrix@np.array([0,0,0,1])
        np.testing.assert_allclose(result,[4,3,-2,1])
    def test_initial_brush_state_preserves_always_solid_and_removes_only_disabled_toggle(self):
        node={'name':'func_brush','_gameOrigin':[2.54,7.62,-5.08]}
        entity={'classname':'func_brush','origin':[100,200,300],'hammeruniqueid':'brush'}
        for solidity,disabled,solid in [(0,False,True),(0,True,False),(1,False,False),(1,True,False),(2,False,True),(2,True,True)]:
            result=compiler.brush_state(node,[{**entity,'solidity':str(solidity),'startdisabled':disabled}])
            self.assertTrue(result['resolved'])
            self.assertEqual(result['solid'],solid)
    def test_ambiguous_or_unknown_brush_is_retained_solid(self):
        node={'name':'func_brush','_gameOrigin':[0,0,0]}
        entity={'classname':'func_brush','origin':[0,0,0]}
        self.assertTrue(compiler.brush_state(node,[])['solid'])
        self.assertTrue(compiler.brush_state(node,[{**entity,'solidity':0},{**entity,'solidity':1}])['solid'])
        self.assertTrue(compiler.brush_state(node,[{**entity,'origin':[100,0,0],'startdisabled':True}])['solid'])

if __name__=='__main__':
    unittest.main()
