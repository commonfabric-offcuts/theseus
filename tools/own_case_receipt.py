from __future__ import annotations

"""Read exact reviewed Pool schemas without executing candidate source.

Only exact reviewed source bytes authorize interpretation. Raw originals remain
Refs; command and neutral identities are explicitly derived, never raw fields.
"""
from collections import Counter
import io
from datetime import datetime, timedelta
import re
import tarfile
import tempfile
from pathlib import Path
import zipfile

from tools import base_move as b, ci_known_reds as ci

# Warp8846: exact literal bindings belong to this existing guarded reader.
FINAL_715 = {'head': '4225184688d7503296e1c0034f1418cb48f4a9d3',
 'tree': '28acdaa0460ab1ec990e0cea136049cf37715757',
 'tests_tree': '313a5d22de9923f419a0a474a8f0a3e19a611702',
 'sources': {'tests/reader_persistence_native.mjs': 'b0e81544d9be87d6aa8e28187407296dec1705c7e438f97a01944e3855a54f2b',
             'tests/webkit_native.mjs': '295193023c71ce9e4c55fa84c966efb9dfc4c10953999d93cff0067ec0e97ca9',
             'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
             'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
             'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
             'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
             'tests/fixtures/ui_http.py': 'ab614f015bce3dd0845e8e4e1070c66ad8b7858a62d101f13092be8ccea1b622',
             'tests/outcome_rail_native.mjs': '5835f965cf4035e56524fe37c627e7f1abb1d4de63c834c0bf9494cb6c00b9b8',
             'tests/outline_stars_native.mjs': 'ce682521ecd82ec9e5e117e916a6bf00b2396a6c2442be09f18ceb8ecd43accb',
             'tests/outline_stars_oracle.mjs': 'f71cd4ac0d88755ea25a64224bb75cac61f208e8ed23ff5044e3ec3b3715bd16'}}

TRAIN48 = {'head': '8737fa03cb3a9ec587d8b7b3678a96352b85fd1b',
 'tree': '8f99a0270e6c487331f14a74aa5bdc11b228568c',
 'tests_tree': '936aff89743a7fbc2515129e90eb57d0ae4e028f',
 'sources': {'aim_next/addressing.py': '75270848f19643cd154911ac76da8e412bdfaf404dfba8ef4c68fb65fccb0671',
             'aim_next/colors.py': 'ce9b8d3d99d27dbec0ed75e5edc7702233ddd0faac0fa3460f6997632851146d',
             'aim_next/conversation.py': 'a949cedfa6779af32a137db5860ff727f6a84c287697790bb2c30a5ae6eb4ad8',
             'aim_next/delivery.py': 'dbe38157bdbae542768d08660dc1e6bf74cf8d8552e20dbd3427e0494ff6e665',
             'aim_next/drafts.py': '13b22842611ffae3fb23e6a0d9dacbe8366e325cbe90334618d009586f382f31',
             'aim_next/health.py': '875a005834558c948c6bb5a090d49d85ce5bcf565aad2f1ac187996d2f2fb350',
             'aim_next/invite.py': 'bc4f6b229bdb06c1ef33a1d91d8e707c4a940333c3079058c697e287f4f35b90',
             'aim_next/live.py': '59b48f32e0f94b8fae61b0393a45fa9ab3fb0fe1daeba59dcc769e4cfd5a1874',
             'aim_next/outcome_end.py': '77a4d2b0930a9ae81eea5a772f3e9aaac0dcb6aa9acd551970a0c7d863018160',
             'aim_next/reactions.py': '9da7a691848f81180fc448189079da8d9f233b597789d56f9ddb7ba3b0dbdbe0',
             'aim_next/server.py': '527a555964efc55dff6e5aed8b5dce390a63b81c3fbaad45b057c80420d6b095',
             'aim_next/stacks.py': '80ed518a72bd26e08ed51c4a6a8642c155c50deed49876cafb3c4cd823ac7ba6',
             'aim_next/topic_reading.py': 'cce7c0acd97f75cc9ebd6c54c86b70952ba8c9e00b3e455b072d6d70db1a636a',
             'aim_next/web_build.py': '1cf75a3ace78e10bac383df048893d0962ede3133ed709e6d9f49904fb8fd450',
             'tests/acts.json': '145161b14cedd105fd969edb786c07abe2b09be7ee4167c24d5866c18a435e4e',
             'tests/agent_colors_native.mjs': '015e888dbdd2ffd63ca584df004294ac5a5c6a9aafb46104fcb67039b8f83145',
             'tests/card_scroll_probe.mjs': '58e1a33fbf564e9e52a1f1c7f32e8ba20bfae19139871ff7b2a9c47faec2045e',
             'tests/compose-reach.mjs': '316d1b7ece73cc126b990dc534d48456b7761003a06a73052fbc1d4d1fd16cb5',
             'tests/conversation_native.mjs': '77077ceb594535ea53831c9e83f20f0e6c24ba23d55988494174e4b57a990c0f',
             'tests/device_native.mjs': '0233e134babb520ffc3cc5edd4791369f0b73bb7089a4e01be72d97cb6941a08',
             'tests/fixtures/item_645_original_web.json': '7fbfa4beb4f79d64435d9a976ae510237f95d7ab5f1eecd7fbdc9bd79913cede',
             'tests/fixtures/item_645_original_web.tar.gz': '3f33b25cff0cb7571182c0ffd3928e56899f1cf6c7c48898bdc93632a3749994',
             'tests/fixtures/mini_dom.mjs': '318cb7fa062601497ba5b68e763b6d562cbdf8c0b6d65bda11871ed381d9b059',
             'tests/fixtures/ui_http.py': '8b935a49acdf454148b8be960b46d2a5e3e2977a7ba27286115f2c8220b11a59',
             'tests/fold_native.mjs': '1cbe59ef67e41446fee8dd1ffb4e17b0d9f428928ebc8a8dd8d42ed29698d497',
             'tests/form_rules_native.mjs': 'd993ae15cafdd2296c5d2d35fb9ca178d3667664be7650ef403c8ce61893f53c',
             'tests/health_native.mjs': '071b1362ed0afa7bbb3baba56df5e2327204fd8e88d0b2bcb468e6388fe03b6b',
             'tests/links_native.mjs': '116577383c2d1b2acdc3975d7a3d5d1c0f9dca37938279a9abdb2e119e73e0e4',
             'tests/menu_glyphs.mjs': 'b098b06f7bb61a6254260bb5671fe91904387dd12c82d84eb81f1c4f11767b1e',
             'tests/message_edit_native.mjs': '6f1f5d34417d232bc79eb1e0b64b08b37b7daf73e8bdf8dc0cc9ee323b01f28a',
             'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
             'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
             'tests/new_line_native.mjs': '74e261d9249623563188a4eb1c8d16797e21dd082e064dbb63ebca661dfdc8d4',
             'tests/notebook_button_geometry.mjs': 'ceb09d753dfa87382e1f0ce7c4e72bf23bb456c1c36fac1d916c6e3c85d29317',
             'tests/notebook_card_images_native.mjs': '43879505d7df15a92582dcfcac4463d218f1b5b21919dad5e77eb0b97380090d',
             'tests/notebook_pages_native.mjs': '02ffb443995a05f2a4cc8bc6e64f8a09b1d279e7f5c893d3a4665b6a28af1afb',
             'tests/notebook_sheet_native.mjs': 'a83bec0e596acf8196675513508fccdacf382f88852de5fcc011513faa3b1000',
             'tests/outcome_light_native.mjs': '3ce0712d2ff5b463529435bc572795ae8ec6b95a90a91cc836224d5ac82ce5c4',
             'tests/outcome_rail_native.mjs': 'a58ab407565154530fc4216e0ff4e84fd62e17f3f9bdfac08b9f5d252d02634f',
             'tests/pipeline_native.mjs': 'e420eadb5166212c7477ea14c97aa6bf54aaa059360f5a52084a45e496046626',
             'tests/png-bands.mjs': '58ccd62c53461c6eec8306a2e540c1f643f1a17ee8c50d499364ab77506685a1',
             'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
             'tests/reader_asks_native.mjs': '2d233f2cf936132c28157f9c85d0e62ad19c7338e091c9527799a7a68db62346',
             'tests/reader_colors_native.mjs': 'e75352ce703cf14f878840c36d8440f48a6e742dd942edb4cd86fc891977bf1b',
             'tests/reader_departure_native.mjs': 'ca9b6c2e0fa4a65cf409f256f14c38927c3c43982dc8a3df73d41289f072b4f3',
             'tests/reader_freshness_native.mjs': '866fc6d40dbc1ec5327941a1dc244fd4b359f8417c5a23392b25c66cc696fbf6',
             'tests/reader_images_native.mjs': '93da7f6eda230dcc832b076c53b09e745568341d0810f3bf0d99bc0033d13444',
             'tests/reader_inline_native.mjs': '84c5546c760afe8cc1ca19fd67d7b261d644b1fa93f9a8bbfc33215035a51647',
             'tests/reader_live_native.mjs': '30e08bcbfc98bb0a6151e095ad9bd3f0eecb4dc7970737ad6766fdfc2c1e052a',
             'tests/reader_navigation_native.mjs': '67ca666ed034c54fa1f30a63e73b8c0423bff3ba22b1b6bac2b9169f001f0b84',
             'tests/reader_persistence_native.mjs': '5e444e272e03321c111b38c126f5faa62393ed100fb9c5bacc3fbc2d8d845629',
             'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
             'tests/render_native.mjs': '46a0b321af03d60d577d7b26e6037877612d18f3ae0e43c66a36d9dc58ab5722',
             'tests/set_aside_native.mjs': 'edfddfd6248ddb21605711d168d5fd8edfb2c214a619da59052cdbe74152e952',
             'tests/stack_native.mjs': '2031276a307382a875cff8ba13e880d2897bf239c98a32afe56bcd78e0b61e7c',
             'tests/targets_native.mjs': '01a06ca7487d3f8cbca054aabde8bc70720ae8cef078861b85ff4c6c9470b74c',
             'tests/team_bar_native.mjs': 'be30eea3a78fb5b23d655e35dee53e4aee72c97308ae77db46d55dfe0f6c4d92',
             'tests/team_invite_native.mjs': '10b4148a55174165b3c43dc5472aa74740e578e44cbc5e0c65ae84e2b3124a08',
             'tests/topic_duties_native.mjs': 'd267f5abb26850eeaf9ec0abd43d36f38e4f22e0685e0725aa82fff97097a472',
             'tests/topic_header_native.mjs': 'ff5fafa7d7f85ca21dd037a4acbeee4b544ec56c2ad7f6ad12c6674632fa670d',
             'tests/topic_list_native.mjs': 'b9a76453e5adbcab3b5ac80b5b19e29c83c1b951324470f727de6a169ca8c6b2',
             'tests/topic_reading_native.mjs': '3e49740416bf5bc0bdb60114f93cc82bcb8185f0f5f2a013435b8b11ee76a2f0',
             'tests/topic_sources_native.mjs': '25dae2dcdf158d4583f95711e585b6a9449093deab221a9b2099bf3c1c474088',
             'tests/topic_title_native.mjs': '7db642af377cf09a0dcd7596c9bb61d3b4a01f7404380825cb872fbe0f48497a',
             'tests/topic_work_native.mjs': 'ae05ef54d24641f3f588bf5764ede8e87ed87eb3305f4f502bd4ac61f61a11e1',
             'tests/ui_folded_names.test.mjs': 'fe48db05b6deb83c515e28635b9c3150652504f6680f73d3a861f2e95f745c7c',
             'tests/wakes_native.mjs': 'd38ad8ce277012f6b5c9eb12903f35fe22623e23495c50d648978092228066ed',
             'tests/webkit_native.mjs': '8564f1aa309408ab39c63206299a8842797d223edd794294b52aa09c76485c29',
             'tests/whisper_native.mjs': '2333928779b2b417c63f8b3ae1f81341f510d7cbe608d63226cf7ecef7d57b45',
             'tools/ci-input-reads.json': '0ad2bdceb2615dd20d47fc148cbfcb92ffa7b518ec2d1b1ec2a2ddd3585996ef',
             'tools/native.py': '2aa3f4ea33eefd5e2e9c9bf81c112078f95d90817ad25a52d6224db36f5ea73e',
             'tools/release_check.py': 'f59a8689f461366e4582783cf553c0d826a9331ab41876ea33cd2934721ffef3',
             'web/agent-invite.mjs': '8674f7d8d577df715879132274f5860008122a99958251176c0e7210af79c4b1',
             'web/aim.css': '8147a8d18306c90178bdf57220faf967fdd14a48ef1b9be3b319c83add919fc3',
             'web/api.mjs': '2e185c6d4af46de62071ec7170a001213cf7cf0ca5aa0d85f80225901d8de771',
             'web/app-session.mjs': 'eb54e8e693653baededb1247420dc36ab9dae20ab734d62f77d642bb6fb32f50',
             'web/app.mjs': '289ae9a9f4ad41beb4b5d30ed29abbb8f6b8f67588c2e1583fffab4bd8f2cd76',
             'web/arrow-reach.mjs': 'c526963a0aa027cd29bb8ca53553d0dbbf146056ef438d85dde1743c7dce7350',
             'web/at-names.mjs': '1d112894bff1c7f599825bcd2707bb50507d77371cd16130b6489b42ae8a797b',
             'web/attention.mjs': '3f40ee16c27c813c3b24aab4c8100edb6bab5af56d2225a099fe60c5f0e99576',
             'web/author-colors.mjs': 'd4686a6485e622d2ad4fd502c8443027c6edead34c75c9242c2168cab2cdedcd',
             'web/boot.js': 'f1ee4e3761935b7313f2df47f3c4c48118ce291e48abb8fbac3dbf4ec969b04e',
             'web/card-images.mjs': '71b327aa6a60da4b9297345414b6936da16c0693035337e11153a5f7359bc706',
             'web/card-reading.mjs': '6cafe04305055f90f81471b907e06b95c2eedb736e7c6da76b7744734eee828a',
             'web/card-scroll.mjs': '3c11bbe7251c5a7a565d46c3191d07073d020fb16804b1d23e0b2dab8f60b73d',
             'web/characters.mjs': '842150b172dfdea3bf9fa7e461cab587b652d1a1ea89b39191b79e98349a2dac',
             'web/charts.mjs': 'c6629dbc8af223e5de27aa02bc7cee48786d57850780be73b09ab15af8d1752b',
             'web/cleanup.mjs': 'b7e47d160ff61b1c3a2259f8b367ccdb3e0f60efa3ba983f627e2580ff9b4cda',
             'web/color-picker.mjs': 'e322b4099936c67731abc25a290c13f58bb7698e1d4a88f5d6ccf0f900af71a1',
             'web/colors.mjs': '336565226bcdd95732e2c483e9047384c0f6717b5aaa9e9992400d06c4152989',
             'web/compose-bar.mjs': '25cb0baf6f9acc03adca7b38ccb87a8c2cee6e19c0869731ec42267c19f974ad',
             'web/coordination-stacks.mjs': '30998a00a9d7233184cae3b7d1020163c9c301690ba80729a5f57fbae6e6aed8',
             'web/creation-view.mjs': 'c497b6262d3c5121eefc40b9f3d7ca1a3636708ff4735b99ced052fa59f215f8',
             'web/creation.mjs': 'a2330026dad4224d04ebd9d09bbd2f1571ed150e7baea51771fc6804dd0a01ef',
             'web/deck-page.mjs': '9a9989f4b7fe1a9a7bbe772fc67b5bebc55562ce182c742ae9af33e64a5d39cc',
             'web/deck.mjs': 'b2270c8a9472534815f0a52625ce9eb63f284dced30fed1e8547c5273ad3dbe7',
             'web/dismiss.mjs': 'bfb49398e0291f57bd265df3b2fb4a7efc95750cc42958a8d806e7140b870763',
             'web/dossier-cover.mjs': '5a0a78c49f5ba50a1b699c07736340a6e3904fedbf5e714b53afea7923fb8f34',
             'web/editor.mjs': 'de97652d0874e14f98115f39d1df9d16e5c082e616fff6bc4df0c1bdba099963',
             'web/feed-fence-copy.mjs': '5994f4e7756d7a74c18cb57d9d2a9b5d0492f70178af8e030fec8dc2a8601aa3',
             'web/feed-passages.mjs': '03f132d91c45b3894829f20c1fd6f458f6e3f422e038f5db01d2f7955e0987a5',
             'web/fence-copy.mjs': '72febc2707c43ddbe5e0c5f7d5fe57c8a6970ff0d9da922a29d3852e79b75117',
             'web/fences.mjs': 'c535135d251d06f90ff56e044f471fb61cd11595394b27924726169ee2648e14',
             'web/fold.mjs': '932870ddc4a895b4ef60b469d30f0d424bccbb9a8f2318676c5956cb87825ae8',
             'web/freshness.mjs': '2e89f5193da7b670c21a902762c3b0f4f4a41094b74cb216c5f41a336befe7cf',
             'web/glyphs.mjs': 'bbcdf69d9feb7e8870bf71650dd5bc26f9ab8852a0f446eabe01f9ae5905ab53',
             'web/health-light.mjs': 'e0a1061aa3bbf39ecded2122b45ec6face28e8c73855ec6d9d043908e8bb897c',
             'web/health.mjs': '00c01a45fd84187733b86378d0a2ec5526b6bbbbf3209dea06367e357fc9f328',
             'web/image-pick.mjs': '0c56273c3929d0212d3b0b32142ed9bf6f90c9282390ceae75722ccb2b224d8a',
             'web/image-rows.mjs': 'ff3aebd0b2ec416d43170f2c8c59f5a0bafe4d59f4488c82dcda2f2d2c90c603',
             'web/in-place-navigation.mjs': '7cbc341f6d355d4e829dc5791e2332e408120f56a5a6d6d61d74fd0c5d7907be',
             'web/index.html': 'c35dd9063dccab38d21ab29d871115bdd934b5b818aad9020ad04828b8ad12db',
             'web/inline-composer.mjs': '5f7944054ad2efa223640b1c2f5bc130e8e82f0218bda8b6e6ed9f0b73e72a0c',
             'web/intent-journal.mjs': 'ebdc3eb47fc065010c25447890b717d1f7e59bc9030ea3366b5b29b68492ed59',
             'web/interaction-guide.mjs': '29a4ab52b638209ac97b89ae06726895be0ce2c38954909b3b59781841491bca',
             'web/journal.mjs': '195c90bfd5827652a31201a8fc5d45d47277a54da27b11db39ef1f2e622c4426',
             'web/key-tree.mjs': '7490ff3e1f7ac61faff2acfec12cf4e94d4ce99a8cc71e23230dc2eddb1af53c',
             'web/layout.mjs': '3b4ee03eca9bc5a188ebf95017b05a39a7cd0536a0d00a28dd6efbf5d515f3f2',
             'web/line-move.mjs': '85bb9f2a6a2f9f490facd015c47fd761d4e60d0aea8d3ee3a7f389d9d7fe7582',
             'web/line-room.mjs': 'b6db5f5302a8f76b729d3bc27138435cdce981addabcb7df3f84ff1d44dce825',
             'web/lines.mjs': '25f4648ccf4f16e72e00d5afa1e2f0309a13ae6619377dd3131499f81637cc5d',
             'web/links.mjs': '114f588b4918190c1267c96413a619c4c277544f4271b0185022c780e9c7e17d',
             'web/lit-field.mjs': '0ffadb6e4f183a2f06de416fa2018ec5bd59ad4741e87321310a7a7eb314a981',
             'web/live.mjs': 'd143e54f0e9713f32b65e18aa514482a4d67855ce90a11745cabdf70a68ba1c6',
             'web/marks.mjs': 'd00fc13ea194f253e4d0e1a1c664a98ca297065bade27a3d95bdbc3ff06241f4',
             'web/message-edit-writing.mjs': '85f7ba249e0ae191ac7ec99030fda4cfb9aaab11b2e87e8e2d0476a281a8f77a',
             'web/message-edit.mjs': 'a667458fb74d212f18718834343742e84051b57e0206df7927af4d425cbe0822',
             'web/message-format.mjs': 'e9537539159c6eb465601d610250576f473279bd22d731c2501fa74a5ea39d85',
             'web/message-menu.mjs': '75eed587fdcf9fa33b8655fc4ecc6c87b06e6f492efa060857772fb1ef04834b',
             'web/message-preview.mjs': '8870246948dfb8df17c5db0662a3eaf89f582892ed7982866793887e5ed371c9',
             'web/notebook-create.mjs': 'bed172bb238dae83759bcf4dd2d56adb8ddcd97112c23affacf1ab33628b5fc6',
             'web/notebook-images.mjs': '827e2873b769e7f9cfb19854f1fa1bae829ddd1ab8f604cfcdf1b8aa33e8a1ef',
             'web/notebook-page.mjs': '50d37877d898bdfe4415043c2a1b2cb7914484fee524b08684bb094215c793fc',
             'web/notebook-sheet.mjs': 'c2daae7680571950a80d38d9a0bbbc34373a39e751e9130073da64c727befae6',
             'web/notebook-writing.mjs': 'cbe1b5816afd70535b08c17ed77fe63ea998d9199b5b4f1f644ec187745077e6',
             'web/opening-store.mjs': 'ce0975eab4e1e61fc6fc49e3541e3d909df63cd79d5be8cb22683f309abafb0e',
             'web/opening-view.mjs': 'f0a26b577a37ba247d00cda9426bc4b31acda77d98aa52f11de0e5510cdba8c3',
             'web/opening.mjs': '8e7f003c9f9d4f3247391571d25fd4e86dc28a1829e6366d1407e86cf0b25166',
             'web/outcome-conversation.mjs': '0c022a82a9b69f7432609ee02892f422374dda0478458ce9203d1288e4aaf059',
             'web/outcome-end.mjs': '149bcef767ec7ae9cf204fa2857d8a09d294fe23f685bb19ddcc7e1a65981d92',
             'web/outcome-light-words.mjs': '4a20255535b9ca17279f14232bc60ea34e4c648247d87290aa2e97d16b1d9969',
             'web/outcome-light.mjs': '0144413d80d5f168da762e7c5cff6ebaee387cfe7b3541f742e13db37b0ce502',
             'web/outcome-purpose.mjs': '727eb2413c05ef6f9225e17a059ac1cab9ebdf597b6476f3e203bfda92f933a1',
             'web/outcome-references.mjs': '0952ead63515fc62a4b0f2bf68f582e450350ec0c145aad6b36b05291de5304e',
             'web/outcome-scope.mjs': '165d297410d59068b32ec19dbdcb491c6dd9cb388b28d081bf5e95797aa47740',
             'web/outcomes.mjs': '9e7a4ed0eab84199cde1cc89a6d48e40ae73805252db47c721e0ae24382b0f76',
             'web/outline-order.mjs': '0a36fe1464da9efca689622cea297b7607b2065dc25a7651b5b6c5d3df2bf7a0',
             'web/outline-rail.mjs': '0e909f688207d826eede6caab51a8b1ec965ce1da2d09dbfbd593aeefd4621c0',
             'web/page-changes.mjs': '7a7ccaab4086cdc96c583237ad248f5e4d4e4600817cac1637bfb4cf850f3710',
             'web/page-here.mjs': 'bfd72a71a8ad7bcb91725ce11ba0fc8e98599c8b10731978a5221f68bc7a079a',
             'web/page-image.mjs': 'ac1a044cc27d902acc0daafed36eccab0aba800fea073a7eb8c293a8056efe86',
             'web/page-reads.mjs': '73468e7239dc0b96024ecda961ba1a8cafd78f37cbddd5e67851979a69213e29',
             'web/pane-keys.mjs': '48158a940b312697c56cbdf5f1fe809f8a290af94f2d7426ea7ff3a4dacb5f37',
             'web/panes.mjs': 'f8235b42be76870a49e305131b89fa63833a53cb80e08de946be3f18f8a13d55',
             'web/people.mjs': 'fff37198bca8635bcd2b1ccac3f0c24777b3ac3f3bbf62e142d5629c49f96c56',
             'web/phone-check.mjs': '8393cdd300d22e36febe72a727c78bf77ffb25765c699c633e7fce783d9007fd',
             'web/pipeline-words.mjs': 'd613ca33124e6e71286dbc40f7b5a22750741bae3dec1bcbd4ff7f576ab9d953',
             'web/pipeline.mjs': '469b64011da84a565648223820ddf88efc8be7f006ab51bd43eff8bea818354b',
             'web/press-hold.mjs': 'f12e3e7d1d16c095e6a05ba276e386b7c6d9f3c2a6b1bb04bdd2d24edb369c09',
             'web/press-note.mjs': '4fcca13317534cf5a86f1ffa3f72dbfc40603617866f84c929f8fb6525baa32d',
             'web/quick-create.mjs': '78ac5c0e6851e45ec7e22b586cf9b5193a7969eaf622bc12ef0b78f0352f6c76',
             'web/rail-drawer.mjs': '387ea66d9b4b8ee4da4613934c68a89cc222610d6071b1627db39be85e23ce0f',
             'web/rails.mjs': '1a23bd58a3a5e26ccdc5c6fbb7f2beae09ae0bafa68a584921600089731df714',
             'web/reactions.mjs': 'ce37db7ff5d8a1d17f6f293ef0c40fbc03a2dc9a595993a4ff4af754bdfa5801',
             'web/read-through.mjs': 'd1f76d7e91f3a0e9d74b54ef6ce2513ee4f32fe3926ce9ed03f3916e78360d8e',
             'web/reader.mjs': '623c0ae44ed3031dfbd8938ecb88c74fb5e386c14a8ba6164af9ba1bb180b8dd',
             'web/repaint.mjs': '0fab340e3795e19a17d2e0e73e23b6c603e7189cda1486587b601444a0c21722',
             'web/replies.mjs': '5d38794953d4e7fcdec2e1ea1fa0003ab34e59b86ed6d08bd975e1774939647e',
             'web/reply-stacks.mjs': '0cb160a6d77eb93215e9d378b87dc4476f70e65af830c129dffeb4135b7fe3d3',
             'web/reveal.mjs': 'a890704e6699c879d4a6f3324d4de68853d7f01b35f6651a089f7b568eb83212',
             'web/session-renewal.mjs': '55fd952693216e8809952424330a4ee14d766b7d9f775d1b62efef2a3886cdd8',
             'web/session.mjs': '0c2c2c363a8b0ea65a9b094c33f57d7148eea06490692d04652fd78b025d35c9',
             'web/sheet-holder.mjs': '4660a00b0eac5e960569b4a4221ba5a9766fb4ca80ef063f643adebb766f27fa',
             'web/skills.mjs': '994683e37a4b8899201734f628c76de5dc0197b75501336bec907895e19a69bb',
             'web/stack-feed.mjs': 'fb6f2d53dfcc6a9f287e1c2aa70afce542ad1237b400ac9cb8bb57145f6df5fa',
             'web/stack-look.css': 'c21709d3a5391a06250010fc6d3b1ab6ad86beb80c66fa564a9abe655cd1e1ac',
             'web/stack-order.mjs': '13ef33db1a4caa26a3c9cc36c80a0b8c974152ad3a255ed06ae5e348c5396abb',
             'web/targets-words.mjs': 'b9b30de4a1a024ab54dddafbfac318069737c6d9609c389cd589bbc243a0a3d9',
             'web/targets.mjs': 'de0a8bb1ac09fc91230af8f7083998f4a04022e3f3ebede239c7511a21fb6b1c',
             'web/things-rail.mjs': '86da2cc925db8c5bce31647614f77a346a93cf22ec2f176b92c18b4e3f7031fe',
             'web/times.mjs': '2084d0f190f87152a805d79996a652e9b9559ad6754d6f485ac7ab2abf64bd6d',
             'web/topic-header.mjs': '0cffe185df1130d0b7a0d337c860408df11685ddc290c4a22bdea8ca92feb23d',
             'web/topic-navigation.mjs': '5c600470c465632693bee7b0c66b77390deff399c8b2bf20698b1e451f3874a3',
             'web/topic-settings.mjs': '46bcf64e0f1898646b1b86c3cf4b5d5744fe96cc7de732d6da7d8fd0a9bf3b92',
             'web/topic-state.mjs': 'e48ece86b12485c82edb8977c0be817d033fab2d2e465ebb127514e6dac0a7f8',
             'web/topic-views.mjs': 'c61cbd89d10a0749ff24a6f9495fabffae0c25266f0cf9120797e26d6ca54932',
             'web/unanswered.mjs': '60d522fa800ad6f422d984c2376a52950bd2b02546e8f5c7e84aab1a1c708d59',
             'web/upload-cleanup.mjs': 'fe4dd1a99f902bd6514ea515c3567718e892fbb468c559c11cd36633db125e34',
             'web/upload-state.mjs': 'a6ee6450637c322d86fe260542328c45942c5ef5ad952d97c125d6c37ec38c68',
             'web/uploads.mjs': 'a7d5f13c6a675bb463ff5dee43fde5d36cb758689b4c98df628a958b5c84b504',
             'web/waiting-questions.mjs': '0667e3cea370d6643ea663bd0a1272d52b6a811d1b6368f765f1bca40c0c6a12',
             'web/wake-lights.mjs': '76043c77cd54c5270678cba55a6c511ad8ad3ed84b4ac1488dd3557ca1b4b3e7',
             'web/whisper-choice.mjs': '556651e0688a5f5026ea4b88c765a4964945e3aae1066ca6273cc523fec88cbf',
             'web/writing-helpers.mjs': '37f7c97abacba145939b29fbb5231df5593b4cb560ca9cc0073d5ca59e379734',
             'web/writing-input.mjs': 'c85bf450a61547d75c60a3c4c238795c4a88397e97d6faae4917ee80d21df843'}}

SNAPSHOTS_48 = {'reading': ('aim_next/addressing.py',
             'aim_next/drafts.py',
             'aim_next/reactions.py',
             'aim_next/server.py',
             'aim_next/stacks.py',
             'aim_next/topic_reading.py',
             'aim_next/web_build.py',
             'tests/acts.json',
             'tests/fixtures/item_645_original_web.json',
             'tests/fixtures/item_645_original_web.tar.gz',
             'tests/fixtures/ui_http.py',
             'tests/menu_glyphs.mjs',
             'tests/message_edit_native.mjs',
             'tests/native-calls.mjs',
             'tests/native-page-cleanup.mjs',
             'tests/png-bands.mjs',
             'tests/press-fell.mjs',
             'tests/reader_freshness_native.mjs',
             'tests/reader_persistence_native.mjs',
             'tests/release-rule.mjs',
             'tests/stack_native.mjs',
             'tests/topic_reading_native.mjs',
             'tests/topic_title_native.mjs',
             'tests/ui_folded_names.test.mjs',
             'tools/native.py',
             'tools/release_check.py',
             'web/aim.css',
             'web/api.mjs',
             'web/app-session.mjs',
             'web/app.mjs',
             'web/at-names.mjs',
             'web/boot.js',
             'web/card-reading.mjs',
             'web/card-scroll.mjs',
             'web/cleanup.mjs',
             'web/dossier-cover.mjs',
             'web/editor.mjs',
             'web/feed-passages.mjs',
             'web/fold.mjs',
             'web/freshness.mjs',
             'web/glyphs.mjs',
             'web/image-rows.mjs',
             'web/in-place-navigation.mjs',
             'web/index.html',
             'web/inline-composer.mjs',
             'web/interaction-guide.mjs',
             'web/journal.mjs',
             'web/lines.mjs',
             'web/lit-field.mjs',
             'web/marks.mjs',
             'web/message-edit-writing.mjs',
             'web/message-edit.mjs',
             'web/message-format.mjs',
             'web/message-menu.mjs',
             'web/outcome-conversation.mjs',
             'web/outcome-scope.mjs',
             'web/press-hold.mjs',
             'web/rail-drawer.mjs',
             'web/reactions.mjs',
             'web/read-through.mjs',
             'web/reader.mjs',
             'web/reply-stacks.mjs',
             'web/reveal.mjs',
             'web/session.mjs',
             'web/stack-feed.mjs',
             'web/stack-look.css',
             'web/stack-order.mjs',
             'web/things-rail.mjs',
             'web/times.mjs',
             'web/topic-views.mjs',
             'web/unanswered.mjs',
             'web/upload-cleanup.mjs',
             'web/upload-state.mjs',
             'web/uploads.mjs',
             'web/whisper-choice.mjs',
             'web/writing-helpers.mjs',
             'web/writing-input.mjs'),
 'colors': ('aim_next/colors.py',
            'aim_next/conversation.py',
            'aim_next/delivery.py',
            'aim_next/live.py',
            'aim_next/server.py',
            'aim_next/web_build.py',
            'tests/acts.json',
            'tests/agent_colors_native.mjs',
            'tests/fixtures/ui_http.py',
            'tests/fold_native.mjs',
            'tests/native-calls.mjs',
            'tests/native-page-cleanup.mjs',
            'tests/new_line_native.mjs',
            'tests/png-bands.mjs',
            'tests/press-fell.mjs',
            'tests/reader_colors_native.mjs',
            'tests/reader_freshness_native.mjs',
            'tests/reader_persistence_native.mjs',
            'tests/release-rule.mjs',
            'tests/topic_title_native.mjs',
            'web/aim.css',
            'web/api.mjs',
            'web/app-session.mjs',
            'web/app.mjs',
            'web/author-colors.mjs',
            'web/boot.js',
            'web/cleanup.mjs',
            'web/color-picker.mjs',
            'web/colors.mjs',
            'web/editor.mjs',
            'web/fold.mjs',
            'web/freshness.mjs',
            'web/image-rows.mjs',
            'web/in-place-navigation.mjs',
            'web/index.html',
            'web/inline-composer.mjs',
            'web/journal.mjs',
            'web/lines.mjs',
            'web/live.mjs',
            'web/marks.mjs',
            'web/people.mjs',
            'web/press-hold.mjs',
            'web/read-through.mjs',
            'web/reader.mjs',
            'web/session.mjs',
            'web/times.mjs',
            'web/topic-views.mjs',
            'web/unanswered.mjs',
            'web/upload-cleanup.mjs',
            'web/upload-state.mjs',
            'web/uploads.mjs',
            'web/writing-helpers.mjs',
            'web/writing-input.mjs'),
 'header': ('aim_next/server.py',
            'aim_next/web_build.py',
            'tests/acts.json',
            'tests/fixtures/ui_http.py',
            'tests/links_native.mjs',
            'tests/native-calls.mjs',
            'tests/native-page-cleanup.mjs',
            'tests/png-bands.mjs',
            'tests/press-fell.mjs',
            'tests/reader_freshness_native.mjs',
            'tests/reader_persistence_native.mjs',
            'tests/release-rule.mjs',
            'tests/topic_header_native.mjs',
            'tests/topic_title_native.mjs',
            'web/aim.css',
            'web/api.mjs',
            'web/app-session.mjs',
            'web/app.mjs',
            'web/boot.js',
            'web/cleanup.mjs',
            'web/dismiss.mjs',
            'web/editor.mjs',
            'web/fold.mjs',
            'web/freshness.mjs',
            'web/glyphs.mjs',
            'web/image-rows.mjs',
            'web/in-place-navigation.mjs',
            'web/index.html',
            'web/inline-composer.mjs',
            'web/journal.mjs',
            'web/lines.mjs',
            'web/links.mjs',
            'web/message-menu.mjs',
            'web/people.mjs',
            'web/press-hold.mjs',
            'web/reader.mjs',
            'web/session.mjs',
            'web/times.mjs',
            'web/topic-header.mjs',
            'web/topic-settings.mjs',
            'web/topic-state.mjs',
            'web/topic-views.mjs',
            'web/upload-cleanup.mjs',
            'web/upload-state.mjs',
            'web/uploads.mjs',
            'web/writing-helpers.mjs',
            'web/writing-input.mjs'),
 'webkit-reading': ('aim_next/health.py',
                    'aim_next/invite.py',
                    'aim_next/outcome_end.py',
                    'aim_next/stacks.py',
                    'aim_next/web_build.py',
                    'tests/acts.json',
                    'tests/device_native.mjs',
                    'tests/fixtures/item_645_original_web.json',
                    'tests/fixtures/item_645_original_web.tar.gz',
                    'tests/fixtures/ui_http.py',
                    'tests/health_native.mjs',
                    'tests/menu_glyphs.mjs',
                    'tests/message_edit_native.mjs',
                    'tests/native-calls.mjs',
                    'tests/native-page-cleanup.mjs',
                    'tests/new_line_native.mjs',
                    'tests/notebook_card_images_native.mjs',
                    'tests/notebook_pages_native.mjs',
                    'tests/notebook_sheet_native.mjs',
                    'tests/outcome_rail_native.mjs',
                    'tests/pipeline_native.mjs',
                    'tests/png-bands.mjs',
                    'tests/press-fell.mjs',
                    'tests/reader_colors_native.mjs',
                    'tests/stack_native.mjs',
                    'tests/targets_native.mjs',
                    'tests/team_invite_native.mjs',
                    'tests/topic_reading_native.mjs',
                    'tests/topic_title_native.mjs',
                    'tests/ui_folded_names.test.mjs',
                    'tests/webkit_native.mjs',
                    'tests/whisper_native.mjs',
                    'tools/native.py',
                    'tools/release_check.py',
                    'web/agent-invite.mjs',
                    'web/aim.css',
                    'web/app-session.mjs',
                    'web/app.mjs',
                    'web/arrow-reach.mjs',
                    'web/boot.js',
                    'web/card-reading.mjs',
                    'web/card-scroll.mjs',
                    'web/deck-page.mjs',
                    'web/deck.mjs',
                    'web/dossier-cover.mjs',
                    'web/feed-passages.mjs',
                    'web/glyphs.mjs',
                    'web/health-light.mjs',
                    'web/health.mjs',
                    'web/image-pick.mjs',
                    'web/in-place-navigation.mjs',
                    'web/index.html',
                    'web/interaction-guide.mjs',
                    'web/lit-field.mjs',
                    'web/marks.mjs',
                    'web/message-edit-writing.mjs',
                    'web/message-edit.mjs',
                    'web/message-format.mjs',
                    'web/message-menu.mjs',
                    'web/notebook-images.mjs',
                    'web/notebook-page.mjs',
                    'web/notebook-sheet.mjs',
                    'web/notebook-writing.mjs',
                    'web/outcome-conversation.mjs',
                    'web/outcome-end.mjs',
                    'web/outcome-light-words.mjs',
                    'web/outcome-light.mjs',
                    'web/outcome-scope.mjs',
                    'web/outcomes.mjs',
                    'web/phone-check.mjs',
                    'web/press-hold.mjs',
                    'web/reactions.mjs',
                    'web/read-through.mjs',
                    'web/reader.mjs',
                    'web/reply-stacks.mjs',
                    'web/reveal.mjs',
                    'web/stack-feed.mjs',
                    'web/stack-look.css',
                    'web/stack-order.mjs',
                    'web/targets.mjs',
                    'web/things-rail.mjs',
                    'web/topic-header.mjs',
                    'web/topic-state.mjs',
                    'web/topic-views.mjs',
                    'web/unanswered.mjs'),
 'webkit-colors': ('aim_next/health.py',
                   'aim_next/invite.py',
                   'aim_next/outcome_end.py',
                   'aim_next/stacks.py',
                   'aim_next/web_build.py',
                   'tests/acts.json',
                   'tests/device_native.mjs',
                   'tests/fixtures/ui_http.py',
                   'tests/health_native.mjs',
                   'tests/menu_glyphs.mjs',
                   'tests/message_edit_native.mjs',
                   'tests/native-page-cleanup.mjs',
                   'tests/new_line_native.mjs',
                   'tests/notebook_card_images_native.mjs',
                   'tests/notebook_pages_native.mjs',
                   'tests/notebook_sheet_native.mjs',
                   'tests/outcome_rail_native.mjs',
                   'tests/pipeline_native.mjs',
                   'tests/png-bands.mjs',
                   'tests/reader_colors_native.mjs',
                   'tests/stack_native.mjs',
                   'tests/targets_native.mjs',
                   'tests/team_invite_native.mjs',
                   'tests/topic_reading_native.mjs',
                   'tests/topic_title_native.mjs',
                   'tests/webkit_native.mjs',
                   'tests/whisper_native.mjs',
                   'web/agent-invite.mjs',
                   'web/aim.css',
                   'web/app-session.mjs',
                   'web/app.mjs',
                   'web/arrow-reach.mjs',
                   'web/boot.js',
                   'web/card-reading.mjs',
                   'web/card-scroll.mjs',
                   'web/deck-page.mjs',
                   'web/deck.mjs',
                   'web/feed-passages.mjs',
                   'web/glyphs.mjs',
                   'web/health-light.mjs',
                   'web/health.mjs',
                   'web/image-pick.mjs',
                   'web/in-place-navigation.mjs',
                   'web/index.html',
                   'web/interaction-guide.mjs',
                   'web/lit-field.mjs',
                   'web/marks.mjs',
                   'web/message-edit-writing.mjs',
                   'web/message-edit.mjs',
                   'web/message-format.mjs',
                   'web/message-menu.mjs',
                   'web/notebook-images.mjs',
                   'web/notebook-page.mjs',
                   'web/notebook-sheet.mjs',
                   'web/notebook-writing.mjs',
                   'web/outcome-conversation.mjs',
                   'web/outcome-end.mjs',
                   'web/outcome-light-words.mjs',
                   'web/outcome-light.mjs',
                   'web/outcomes.mjs',
                   'web/phone-check.mjs',
                   'web/press-hold.mjs',
                   'web/reactions.mjs',
                   'web/read-through.mjs',
                   'web/reader.mjs',
                   'web/reply-stacks.mjs',
                   'web/reveal.mjs',
                   'web/stack-feed.mjs',
                   'web/stack-look.css',
                   'web/stack-order.mjs',
                   'web/targets.mjs',
                   'web/things-rail.mjs',
                   'web/topic-header.mjs',
                   'web/topic-state.mjs',
                   'web/topic-views.mjs',
                   'web/unanswered.mjs')}

CASES_48 = {'649': ('reading item 649 phone-320 light page comparison retains the message and its marks',
         'reading item 649 phone-320 light normal corner opens the exact private note by pointer or touch '
         'and keyboard',
         'reading item 649 phone-320 light busy corner preserves writing and recovers to the same note',
         'reading item 649 phone-320 light error corner preserves writing and recovers to the same note',
         'reading item 649 phone-320 light unavailable corner preserves writing and recovers to the same '
         'note',
         'reading item 649 phone-320 light empty and other actor notes have no corner and clearing your note '
         'removes it',
         'reading item 649 phone-320 dark page comparison retains the message and its marks',
         'reading item 649 phone-320 dark normal corner opens the exact private note by pointer or touch and '
         'keyboard',
         'reading item 649 phone-320 dark busy corner preserves writing and recovers to the same note',
         'reading item 649 phone-320 dark error corner preserves writing and recovers to the same note',
         'reading item 649 phone-320 dark unavailable corner preserves writing and recovers to the same note',
         'reading item 649 phone-320 dark empty and other actor notes have no corner and clearing your note '
         'removes it',
         'reading item 649 phone-375 light page comparison retains the message and its marks',
         'reading item 649 phone-375 light normal corner opens the exact private note by pointer or touch '
         'and keyboard',
         'reading item 649 phone-375 light busy corner preserves writing and recovers to the same note',
         'reading item 649 phone-375 light error corner preserves writing and recovers to the same note',
         'reading item 649 phone-375 light unavailable corner preserves writing and recovers to the same '
         'note',
         'reading item 649 phone-375 light empty and other actor notes have no corner and clearing your note '
         'removes it',
         'reading item 649 phone-375 dark page comparison retains the message and its marks',
         'reading item 649 phone-375 dark normal corner opens the exact private note by pointer or touch and '
         'keyboard',
         'reading item 649 phone-375 dark busy corner preserves writing and recovers to the same note',
         'reading item 649 phone-375 dark error corner preserves writing and recovers to the same note',
         'reading item 649 phone-375 dark unavailable corner preserves writing and recovers to the same note',
         'reading item 649 phone-375 dark empty and other actor notes have no corner and clearing your note '
         'removes it',
         'reading item 649 phone light page comparison retains the message and its marks',
         'reading item 649 phone light normal corner opens the exact private note by pointer or touch and '
         'keyboard',
         'reading item 649 phone light busy corner preserves writing and recovers to the same note',
         'reading item 649 phone light error corner preserves writing and recovers to the same note',
         'reading item 649 phone light unavailable corner preserves writing and recovers to the same note',
         'reading item 649 phone light empty and other actor notes have no corner and clearing your note '
         'removes it',
         'reading item 649 phone dark page comparison retains the message and its marks',
         'reading item 649 phone dark normal corner opens the exact private note by pointer or touch and '
         'keyboard',
         'reading item 649 phone dark busy corner preserves writing and recovers to the same note',
         'reading item 649 phone dark error corner preserves writing and recovers to the same note',
         'reading item 649 phone dark unavailable corner preserves writing and recovers to the same note',
         'reading item 649 phone dark empty and other actor notes have no corner and clearing your note '
         'removes it',
         'reading item 649 laptop light page comparison retains the message and its marks',
         'reading item 649 laptop light normal corner opens the exact private note by pointer or touch and '
         'keyboard',
         'reading item 649 laptop light busy corner preserves writing and recovers to the same note',
         'reading item 649 laptop light error corner preserves writing and recovers to the same note',
         'reading item 649 laptop light unavailable corner preserves writing and recovers to the same note',
         'reading item 649 laptop light empty and other actor notes have no corner and clearing your note '
         'removes it',
         'reading item 649 laptop dark page comparison retains the message and its marks',
         'reading item 649 laptop dark normal corner opens the exact private note by pointer or touch and '
         'keyboard',
         'reading item 649 laptop dark busy corner preserves writing and recovers to the same note',
         'reading item 649 laptop dark error corner preserves writing and recovers to the same note',
         'reading item 649 laptop dark unavailable corner preserves writing and recovers to the same note',
         'reading item 649 laptop dark empty and other actor notes have no corner and clearing your note '
         'removes it',
         'reading item 649 phone-320 light B1-root normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 phone-320 light B1-root busy whole target keeps exact writing and recovery',
         'reading item 649 phone-320 light B1-root error whole target keeps exact writing and recovery',
         'reading item 649 phone-320 light B1-root unavailable whole target keeps exact writing and recovery',
         'reading item 649 phone-320 light B1-root absent other actor and empty note leave no corner or '
         'private words',
         'reading item 649 phone-320 light B2-covered normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 phone-320 light B2-covered busy whole target keeps exact writing and recovery',
         'reading item 649 phone-320 light B2-covered error whole target keeps exact writing and recovery',
         'reading item 649 phone-320 light B2-covered unavailable whole target keeps exact writing and '
         'recovery',
         'reading item 649 phone-320 light B2-covered absent other actor and empty note leave no corner or '
         'private words',
         'reading item 649 phone-320 dark B1-root normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 phone-320 dark B1-root busy whole target keeps exact writing and recovery',
         'reading item 649 phone-320 dark B1-root error whole target keeps exact writing and recovery',
         'reading item 649 phone-320 dark B1-root unavailable whole target keeps exact writing and recovery',
         'reading item 649 phone-320 dark B1-root absent other actor and empty note leave no corner or '
         'private words',
         'reading item 649 phone-320 dark B2-covered normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 phone-320 dark B2-covered busy whole target keeps exact writing and recovery',
         'reading item 649 phone-320 dark B2-covered error whole target keeps exact writing and recovery',
         'reading item 649 phone-320 dark B2-covered unavailable whole target keeps exact writing and '
         'recovery',
         'reading item 649 phone-320 dark B2-covered absent other actor and empty note leave no corner or '
         'private words',
         'reading item 649 phone-375 light B1-root normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 phone-375 light B1-root busy whole target keeps exact writing and recovery',
         'reading item 649 phone-375 light B1-root error whole target keeps exact writing and recovery',
         'reading item 649 phone-375 light B1-root unavailable whole target keeps exact writing and recovery',
         'reading item 649 phone-375 light B1-root absent other actor and empty note leave no corner or '
         'private words',
         'reading item 649 phone-375 light B2-covered normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 phone-375 light B2-covered busy whole target keeps exact writing and recovery',
         'reading item 649 phone-375 light B2-covered error whole target keeps exact writing and recovery',
         'reading item 649 phone-375 light B2-covered unavailable whole target keeps exact writing and '
         'recovery',
         'reading item 649 phone-375 light B2-covered absent other actor and empty note leave no corner or '
         'private words',
         'reading item 649 phone-375 dark B1-root normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 phone-375 dark B1-root busy whole target keeps exact writing and recovery',
         'reading item 649 phone-375 dark B1-root error whole target keeps exact writing and recovery',
         'reading item 649 phone-375 dark B1-root unavailable whole target keeps exact writing and recovery',
         'reading item 649 phone-375 dark B1-root absent other actor and empty note leave no corner or '
         'private words',
         'reading item 649 phone-375 dark B2-covered normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 phone-375 dark B2-covered busy whole target keeps exact writing and recovery',
         'reading item 649 phone-375 dark B2-covered error whole target keeps exact writing and recovery',
         'reading item 649 phone-375 dark B2-covered unavailable whole target keeps exact writing and '
         'recovery',
         'reading item 649 phone-375 dark B2-covered absent other actor and empty note leave no corner or '
         'private words',
         'reading item 649 phone light B1-root normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 phone light B1-root busy whole target keeps exact writing and recovery',
         'reading item 649 phone light B1-root error whole target keeps exact writing and recovery',
         'reading item 649 phone light B1-root unavailable whole target keeps exact writing and recovery',
         'reading item 649 phone light B1-root absent other actor and empty note leave no corner or private '
         'words',
         'reading item 649 phone light B2-covered normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 phone light B2-covered busy whole target keeps exact writing and recovery',
         'reading item 649 phone light B2-covered error whole target keeps exact writing and recovery',
         'reading item 649 phone light B2-covered unavailable whole target keeps exact writing and recovery',
         'reading item 649 phone light B2-covered absent other actor and empty note leave no corner or '
         'private words',
         'reading item 649 phone dark B1-root normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 phone dark B1-root busy whole target keeps exact writing and recovery',
         'reading item 649 phone dark B1-root error whole target keeps exact writing and recovery',
         'reading item 649 phone dark B1-root unavailable whole target keeps exact writing and recovery',
         'reading item 649 phone dark B1-root absent other actor and empty note leave no corner or private '
         'words',
         'reading item 649 phone dark B2-covered normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 phone dark B2-covered busy whole target keeps exact writing and recovery',
         'reading item 649 phone dark B2-covered error whole target keeps exact writing and recovery',
         'reading item 649 phone dark B2-covered unavailable whole target keeps exact writing and recovery',
         'reading item 649 phone dark B2-covered absent other actor and empty note leave no corner or '
         'private words',
         'reading item 649 laptop light B1-root normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 laptop light B1-root busy whole target keeps exact writing and recovery',
         'reading item 649 laptop light B1-root error whole target keeps exact writing and recovery',
         'reading item 649 laptop light B1-root unavailable whole target keeps exact writing and recovery',
         'reading item 649 laptop light B1-root absent other actor and empty note leave no corner or private '
         'words',
         'reading item 649 laptop light B2-covered normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 laptop light B2-covered busy whole target keeps exact writing and recovery',
         'reading item 649 laptop light B2-covered error whole target keeps exact writing and recovery',
         'reading item 649 laptop light B2-covered unavailable whole target keeps exact writing and recovery',
         'reading item 649 laptop light B2-covered absent other actor and empty note leave no corner or '
         'private words',
         'reading item 649 laptop dark B1-root normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 laptop dark B1-root busy whole target keeps exact writing and recovery',
         'reading item 649 laptop dark B1-root error whole target keeps exact writing and recovery',
         'reading item 649 laptop dark B1-root unavailable whole target keeps exact writing and recovery',
         'reading item 649 laptop dark B1-root absent other actor and empty note leave no corner or private '
         'words',
         'reading item 649 laptop dark B2-covered normal own card and whole target with original-runtime '
         'negative and restored native presses',
         'reading item 649 laptop dark B2-covered busy whole target keeps exact writing and recovery',
         'reading item 649 laptop dark B2-covered error whole target keeps exact writing and recovery',
         'reading item 649 laptop dark B2-covered unavailable whole target keeps exact writing and recovery',
         'reading item 649 laptop dark B2-covered absent other actor and empty note leave no corner or '
         'private words'),
 '656': ('colors item 656 oldhead red: permission rebuild restores the header title; exact restore green',
         'colors item 656 normal: pencil renames in place; reload keeps header and rail; settings rename '
         'still works at 320 light',
         'colors item 656 editing: Escape and unchanged Return record nothing, preserve the page and '
         'keyboard reaches the pencil at 320 light',
         'colors item 656 busy: one save waits on its answer without moving the controls or losing the title '
         'at 320 light',
         'colors item 656 refused: newer title stands, typed words stay beside the refusal, Return recovers '
         'at 320 light',
         'colors item 656 error: an empty title is refused in place and Escape keeps the saved title at 320 '
         'light',
         'colors item 656 permission: a member who cannot rename has no pencil; an owner gains and loses it '
         'live; Conversation has none at 320 light',
         'colors item 656 membership-editing: nonparticipant owner loses reader_may_say during rename; '
         'heading returns, exact writing and operation recover, native Escape then rename at 320 light',
         'colors item 656 membership-busy: nonparticipant owner loses reader_may_say during rename; heading '
         'returns, exact writing and operation recover, native Escape then rename at 320 light',
         'colors item 656 normal: pencil renames in place; reload keeps header and rail; settings rename '
         'still works at 320 dark',
         'colors item 656 editing: Escape and unchanged Return record nothing, preserve the page and '
         'keyboard reaches the pencil at 320 dark',
         'colors item 656 busy: one save waits on its answer without moving the controls or losing the title '
         'at 320 dark',
         'colors item 656 refused: newer title stands, typed words stay beside the refusal, Return recovers '
         'at 320 dark',
         'colors item 656 error: an empty title is refused in place and Escape keeps the saved title at 320 '
         'dark',
         'colors item 656 permission: a member who cannot rename has no pencil; an owner gains and loses it '
         'live; Conversation has none at 320 dark',
         'colors item 656 membership-editing: nonparticipant owner loses reader_may_say during rename; '
         'heading returns, exact writing and operation recover, native Escape then rename at 320 dark',
         'colors item 656 membership-busy: nonparticipant owner loses reader_may_say during rename; heading '
         'returns, exact writing and operation recover, native Escape then rename at 320 dark',
         'colors item 656 normal: pencil renames in place; reload keeps header and rail; settings rename '
         'still works at 375 light',
         'colors item 656 editing: Escape and unchanged Return record nothing, preserve the page and '
         'keyboard reaches the pencil at 375 light',
         'colors item 656 busy: one save waits on its answer without moving the controls or losing the title '
         'at 375 light',
         'colors item 656 refused: newer title stands, typed words stay beside the refusal, Return recovers '
         'at 375 light',
         'colors item 656 error: an empty title is refused in place and Escape keeps the saved title at 375 '
         'light',
         'colors item 656 permission: a member who cannot rename has no pencil; an owner gains and loses it '
         'live; Conversation has none at 375 light',
         'colors item 656 membership-editing: nonparticipant owner loses reader_may_say during rename; '
         'heading returns, exact writing and operation recover, native Escape then rename at 375 light',
         'colors item 656 membership-busy: nonparticipant owner loses reader_may_say during rename; heading '
         'returns, exact writing and operation recover, native Escape then rename at 375 light',
         'colors item 656 normal: pencil renames in place; reload keeps header and rail; settings rename '
         'still works at 375 dark',
         'colors item 656 editing: Escape and unchanged Return record nothing, preserve the page and '
         'keyboard reaches the pencil at 375 dark',
         'colors item 656 busy: one save waits on its answer without moving the controls or losing the title '
         'at 375 dark',
         'colors item 656 refused: newer title stands, typed words stay beside the refusal, Return recovers '
         'at 375 dark',
         'colors item 656 error: an empty title is refused in place and Escape keeps the saved title at 375 '
         'dark',
         'colors item 656 permission: a member who cannot rename has no pencil; an owner gains and loses it '
         'live; Conversation has none at 375 dark',
         'colors item 656 membership-editing: nonparticipant owner loses reader_may_say during rename; '
         'heading returns, exact writing and operation recover, native Escape then rename at 375 dark',
         'colors item 656 membership-busy: nonparticipant owner loses reader_may_say during rename; heading '
         'returns, exact writing and operation recover, native Escape then rename at 375 dark',
         'colors item 656 normal: pencil renames in place; reload keeps header and rail; settings rename '
         'still works at 390 light',
         'colors item 656 editing: Escape and unchanged Return record nothing, preserve the page and '
         'keyboard reaches the pencil at 390 light',
         'colors item 656 busy: one save waits on its answer without moving the controls or losing the title '
         'at 390 light',
         'colors item 656 refused: newer title stands, typed words stay beside the refusal, Return recovers '
         'at 390 light',
         'colors item 656 error: an empty title is refused in place and Escape keeps the saved title at 390 '
         'light',
         'colors item 656 permission: a member who cannot rename has no pencil; an owner gains and loses it '
         'live; Conversation has none at 390 light',
         'colors item 656 membership-editing: nonparticipant owner loses reader_may_say during rename; '
         'heading returns, exact writing and operation recover, native Escape then rename at 390 light',
         'colors item 656 membership-busy: nonparticipant owner loses reader_may_say during rename; heading '
         'returns, exact writing and operation recover, native Escape then rename at 390 light',
         'colors item 656 normal: pencil renames in place; reload keeps header and rail; settings rename '
         'still works at 390 dark',
         'colors item 656 editing: Escape and unchanged Return record nothing, preserve the page and '
         'keyboard reaches the pencil at 390 dark',
         'colors item 656 busy: one save waits on its answer without moving the controls or losing the title '
         'at 390 dark',
         'colors item 656 refused: newer title stands, typed words stay beside the refusal, Return recovers '
         'at 390 dark',
         'colors item 656 error: an empty title is refused in place and Escape keeps the saved title at 390 '
         'dark',
         'colors item 656 permission: a member who cannot rename has no pencil; an owner gains and loses it '
         'live; Conversation has none at 390 dark',
         'colors item 656 membership-editing: nonparticipant owner loses reader_may_say during rename; '
         'heading returns, exact writing and operation recover, native Escape then rename at 390 dark',
         'colors item 656 membership-busy: nonparticipant owner loses reader_may_say during rename; heading '
         'returns, exact writing and operation recover, native Escape then rename at 390 dark',
         'colors item 656 normal: pencil renames in place; reload keeps header and rail; settings rename '
         'still works at laptop light',
         'colors item 656 editing: Escape and unchanged Return record nothing, preserve the page and '
         'keyboard reaches the pencil at laptop light',
         'colors item 656 busy: one save waits on its answer without moving the controls or losing the title '
         'at laptop light',
         'colors item 656 refused: newer title stands, typed words stay beside the refusal, Return recovers '
         'at laptop light',
         'colors item 656 error: an empty title is refused in place and Escape keeps the saved title at '
         'laptop light',
         'colors item 656 permission: a member who cannot rename has no pencil; an owner gains and loses it '
         'live; Conversation has none at laptop light',
         'colors item 656 membership-editing: nonparticipant owner loses reader_may_say during rename; '
         'heading returns, exact writing and operation recover, native Escape then rename at laptop light',
         'colors item 656 membership-busy: nonparticipant owner loses reader_may_say during rename; heading '
         'returns, exact writing and operation recover, native Escape then rename at laptop light',
         'colors item 656 normal: pencil renames in place; reload keeps header and rail; settings rename '
         'still works at laptop dark',
         'colors item 656 editing: Escape and unchanged Return record nothing, preserve the page and '
         'keyboard reaches the pencil at laptop dark',
         'colors item 656 busy: one save waits on its answer without moving the controls or losing the title '
         'at laptop dark',
         'colors item 656 refused: newer title stands, typed words stay beside the refusal, Return recovers '
         'at laptop dark',
         'colors item 656 error: an empty title is refused in place and Escape keeps the saved title at '
         'laptop dark',
         'colors item 656 permission: a member who cannot rename has no pencil; an owner gains and loses it '
         'live; Conversation has none at laptop dark',
         'colors item 656 membership-editing: nonparticipant owner loses reader_may_say during rename; '
         'heading returns, exact writing and operation recover, native Escape then rename at laptop dark',
         'colors item 656 membership-busy: nonparticipant owner loses reader_may_say during rename; heading '
         'returns, exact writing and operation recover, native Escape then rename at laptop dark',
         'colors item 656 base comparison: header, rail and settings at every width and theme',
         'colors item 656 mutant: The title pencil opens the existing title field in the header',
         'colors item 656 mutant: The title pencil follows the existing permission to rename',
         'colors item 656 mutant: The header gives the title field back so settings rename still works',
         'colors item 656 mutant: A refused header rename keeps its words and recovery notice in the header',
         'colors item 656 mutant: A permission panel rebuild keeps the title field model for exact writing '
         'and Escape recovery')}

MUTANTS_656 = (('The title pencil opens the existing title field in the header',
  (('web/topic-state.mjs',
    'e48ece86b12485c82edb8977c0be817d033fab2d2e465ebb127514e6dac0a7f8',
    'f9f651778a4a275055795a28ff76d76ae68dd5f0f8cf2d73e64fd8744f87b1c4'),)),
 ('The title pencil follows the existing permission to rename',
  (('web/topic-header.mjs',
    '0cffe185df1130d0b7a0d337c860408df11685ddc290c4a22bdea8ca92feb23d',
    'ba957953918079d0450ec8d32b7b2bdad5e52da2c6096d8f77279ccfb9ad6921'),)),
 ('The header gives the title field back so settings rename still works',
  (('web/topic-state.mjs',
    'e48ece86b12485c82edb8977c0be817d033fab2d2e465ebb127514e6dac0a7f8',
    '2a8313dd6a1df88450a74da29608efeb36771a34cbf22b51834f0eaf20239d9f'),)),
 ('A refused header rename keeps its words and recovery notice in the header',
  (('web/topic-state.mjs',
    'e48ece86b12485c82edb8977c0be817d033fab2d2e465ebb127514e6dac0a7f8',
    '6fdefaad32b3a887023be102a34512facf96db755a3b6b54f9e32f5f683fdc3b'),)),
 ('A permission panel rebuild keeps the title field model for exact writing and Escape recovery',
  (('web/topic-state.mjs',
    'e48ece86b12485c82edb8977c0be817d033fab2d2e465ebb127514e6dac0a7f8',
    '6061810e10142847830eda3d296c7f6fb642eb631dc5bcea1b3632e2f3a79c14'),)))

OLDHEAD_656 = {'head': '6f7bf4c428a28a698aa7f3f75675e4cdf711706b',
 'red_source': '72e2e7ded732e527b054a7b3e6c0837d5fc024400ce4de65301ee9882d58393b',
 'fixed_source': 'e48ece86b12485c82edb8977c0be817d033fab2d2e465ebb127514e6dac0a7f8'}


WORKFLOW = '.github/workflows/pool.yml'
SPEC = '.github/pool-run.json'
# Reviewed original code at c4af1c6, not the installed validator or a manifest
# override. The explicitly narrow 652 fallback below retains this 651 profile.
# Any other command/harness convention needs a new reviewed adapter.
SOURCES = {
    WORKFLOW: 'f5cfaa27bccf2348d7024a5bbfdf00e4a724b281cd7680ea16ddd0a226fd9faa',
    'tools/native.py': '2aa3f4ea33eefd5e2e9c9bf81c112078f95d90817ad25a52d6224db36f5ea73e',
    'tools/release_check.py': 'f59a8689f461366e4582783cf553c0d826a9331ab41876ea33cd2934721ffef3',
    'tests/thumbnail_open_native.mjs': '77c7e28ae2288811115c191906ca20e253974c0098dae83a69bf2331169e5fa0',
    'tests/reader_compose_native.mjs': '5c2a6b88fb9068fe32adc4a199101a2ecd4e4bc622dcdf738bbf3c6457589cac',
}
COMPOSE = 'tests/reader_compose_native.mjs'
# Reviewed at 10c4ca6ecfa8e77e0986b0b16838c60a5a9cacc4. These constants,
# never a spec/receipt claim, authorize the additional exact filter.
COMPOSE_652 = 'ee64a06f2626d5cd7c2893b65727168d03a240e87eb06b13a5094be5ea1f76ee'
HELPER_652 = {'tests/card_editor_652.mjs': '11b2e0570b7c6be12515a0551f75a49af593cd2c95cb84211e26b186f31716a6'}
# Exact8652 diagnostic correction; original profile remains separate and valid.
HELPER_652_CORRECTED = {'tests/card_editor_652.mjs': 'e400b065311cc5212a14ed8eeff5ab536dd2f6967b2bb7a0ed450d68d9e44c6d'}
# Narrow fallback: independent producer test trees bind all imports and fixtures.
FAMILIES = {'717': {'head': 'f31e319994ecc96c5565828a53fde75c01bd3386',
         'tests_tree': '4371130014b2cab2853e8831516c2d1f5cfb1f75',
         'sources': {'tests/reader_persistence_native.mjs': 'ff89beeadcaefd631ceaa273fcc22ddfdf0a6f28224ddc18eac6bf7b7aa8b608',
                     'tests/webkit_native.mjs': 'd3f7638a39a10ae26845def968b26da1c2ca4fdbae4d9c0a5c266956065d13f3',
                     'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
                     'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
                     'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
                     'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
                     'tests/fixtures/ui_http.py': '8b935a49acdf454148b8be960b46d2a5e3e2977a7ba27286115f2c8220b11a59',
                     'tests/topic_reading_native.mjs': '855831061528c1c02be140f02e0b8b49b8205f170f9e5b1398db94f87a961fac',
                     'tests/stack_native.mjs': 'ec82b0e865d17a6211f808f7be186623aca9eed1e722402a2b06402af8f550ed',
                     'tests/dossier_promises_native.mjs': 'e46e1d55452b278f917d82c8d13dab88fbbee3115008c90925a2be18c6e2b044'}},
 '715': {'head': '5903d8b8fac63b8b4e6d191dbc8d59db5094d9b0',
         'tests_tree': '144582b8de007234d4552ea81c2d4035c0cf7d28',
         'sources': {'tests/reader_persistence_native.mjs': 'b0e81544d9be87d6aa8e28187407296dec1705c7e438f97a01944e3855a54f2b',
                     'tests/webkit_native.mjs': '4db15fd3c3315c1fd0f47ec97263abda40cb42b3edaaa585ac4d43fe1a05e3ae',
                     'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
                     'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
                     'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
                     'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
                     'tests/fixtures/ui_http.py': 'ab614f015bce3dd0845e8e4e1070c66ad8b7858a62d101f13092be8ccea1b622',
                     'tests/outcome_rail_native.mjs': 'b5797308e822dfea0550830f1a91c30018b90e57664721a945cee38a25d952ef',
                     'tests/outline_stars_native.mjs': '6c196bb9fad58b3c506fed333cc4c5cafecc8efec70aeee391f10cdf967c0ee9',
                     'tests/outline_stars_oracle.mjs': 'f71cd4ac0d88755ea25a64224bb75cac61f208e8ed23ff5044e3ec3b3715bd16'}}}
# Independently reviewed assembly binding (warp8750); never receipt-supplied.
# Original FAMILIES and the copied e6 profile remain exact.
ASSEMBLY_717 = {'head': 'e6f6e5ec30b553511a839252d3aff73bbc12819d',
 'tests_tree': 'ed9493b450303989e6c12c560b38ee0c75101e52',
 'sources': {'tests/reader_persistence_native.mjs': 'ff89beeadcaefd631ceaa273fcc22ddfdf0a6f28224ddc18eac6bf7b7aa8b608',
             'tests/webkit_native.mjs': 'd3f7638a39a10ae26845def968b26da1c2ca4fdbae4d9c0a5c266956065d13f3',
             'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
             'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
             'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
             'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
             'tests/fixtures/ui_http.py': '8b935a49acdf454148b8be960b46d2a5e3e2977a7ba27286115f2c8220b11a59',
             'tests/topic_reading_native.mjs': '855831061528c1c02be140f02e0b8b49b8205f170f9e5b1398db94f87a961fac',
             'tests/stack_native.mjs': '55c328660130b03be5daa108187010780ec5fc716d7b0adfdc85962ab3c18b70',
             'tests/dossier_promises_native.mjs': 'e46e1d55452b278f917d82c8d13dab88fbbee3115008c90925a2be18c6e2b044'}}
# Actual sibling assembly literals (warp8775/8778); source-only, no native approval.
ASSEMBLY_715 = {'head': 'd9b93adfabed0e960a14febf9975de294429248b',
 'tests_tree': 'cc5a7e74dc16adf9c81fa633fd27b2047f40eb39',
 'sources': {'tests/reader_persistence_native.mjs': 'b0e81544d9be87d6aa8e28187407296dec1705c7e438f97a01944e3855a54f2b',
             'tests/webkit_native.mjs': '4db15fd3c3315c1fd0f47ec97263abda40cb42b3edaaa585ac4d43fe1a05e3ae',
             'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
             'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
             'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
             'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
             'tests/fixtures/ui_http.py': 'ab614f015bce3dd0845e8e4e1070c66ad8b7858a62d101f13092be8ccea1b622',
             'tests/outcome_rail_native.mjs': '5835f965cf4035e56524fe37c627e7f1abb1d4de63c834c0bf9494cb6c00b9b8',
             'tests/outline_stars_native.mjs': '6c196bb9fad58b3c506fed333cc4c5cafecc8efec70aeee391f10cdf967c0ee9',
             'tests/outline_stars_oracle.mjs': 'f71cd4ac0d88755ea25a64224bb75cac61f208e8ed23ff5044e3ec3b3715bd16'}}
FINAL_717 = {'head': 'dddf00e171fa3924f12e9a1c4f20cac5a6602d3c',
 'tests_tree': 'aa3a1417a26e171e33d89e778c34edd16dd24ef4',
 'sources': {'tests/reader_persistence_native.mjs': 'ff89beeadcaefd631ceaa273fcc22ddfdf0a6f28224ddc18eac6bf7b7aa8b608',
             'tests/webkit_native.mjs': 'd3f7638a39a10ae26845def968b26da1c2ca4fdbae4d9c0a5c266956065d13f3',
             'tests/native-calls.mjs': 'f3121cf9108a017a77224191b88615618dc152e464de9b42abb7f6c591f3633c',
             'tests/native-page-cleanup.mjs': '1f087302cc6eaca7ffc304a6ec64204d8cb7b59745224ef533fb0fd0a2e14e99',
             'tests/release-rule.mjs': 'b34d024358d9d98ce80434dd080c44eed590253a0ca021a0dafac91370c8268f',
             'tests/press-fell.mjs': '1b8b2a2b779e76033b3d4502178fb87b102b0d21c77a387f53964a02d7e1ebd5',
             'tests/fixtures/ui_http.py': '8b935a49acdf454148b8be960b46d2a5e3e2977a7ba27286115f2c8220b11a59',
             'tests/topic_reading_native.mjs': '855831061528c1c02be140f02e0b8b49b8205f170f9e5b1398db94f87a961fac',
             'tests/stack_native.mjs': '55c328660130b03be5daa108187010780ec5fc716d7b0adfdc85962ab3c18b70',
             'tests/dossier_promises_native.mjs': '1d2472157ec5f3cbeb4d3bb9c18c0336d08a1f7920fa1e52e5a669b14787b4a0'}}
MEMBERS = ('cases.json', 'c1.log', 'c1/native-compose.log', 'c1/evidence/native.json')
JOB_STEPS = ['Set up job', 'Run actions/checkout@v4', 'Run actions/setup-node@v4',
             "Chrome for Testing and Playwright's WebKit", 'The cases', 'Keep the evidence',
             'Post Run actions/setup-node@v4', 'Post Run actions/checkout@v4', 'Complete job']


def source_bytes(git, head, paths):
    with tempfile.TemporaryDirectory(prefix='own-receipt-source-') as temp:
        target = Path(temp) / 'source.tar'
        b.ask(git, 'archive', '--format=tar', '--output=' + str(target), head, '--', *paths)
        with tarfile.open(str(target)) as archive:
            result = {}
            for path in paths:
                member = archive.getmember(path)
                b.require(member.isfile(), 'Pool source is not a file')
                with archive.extractfile(member) as handle:
                    result[path] = handle.read()
            return result


def api_fact(binding, key, github, repository, path):
    saved = b.document(binding['api'][key])
    actual = github.get('repos/' + repository + '/' + path)
    b.require(b.canonical(saved) == b.canonical(actual), 'Pool retained API ' + key + ' differs')
    return saved


def title_log_records(lines, rows, webkit):
    """Consume only the pinned656 reporter's diagnostics in their actual order.

    These are assertions inside a single native case, not extra executions.
    Original raw logs remain bound by their archive and Ref.
    """
    remaining = iter(lines)
    records = []

    def take(names):
        value = next(remaining, None)
        return b.fields(value, names)

    def caught(value):
        b.require(isinstance(value, str) and bool(value.strip())
                  and re.search(r'title|pencil|renam|focus|settings', value, re.I),
                  'Pool656 missing intended mutant failure')

    for i, row in enumerate(rows):
        if not webkit:
            records.append(take('case started'))
        if i == 0:
            old = OLDHEAD_656
            red = take('item oldhead red_source fixed_source caught exact_restoration')
            b.require(type(red['item']) is int and red['item'] == 656
                      and red['oldhead'] == old['head'] and red['red_source'] == old['red_source']
                      and red['fixed_source'] == old['fixed_source'] and red['exact_restoration'] is True
                      and isinstance(red['caught'], str)
                      and 'permission rebuild restores the header title' in red['caught'],
                      'Pool656 oldhead source/restoration differs')
            restored = take('item oldhead restored_control_passed')
            b.require(restored == {'item': 656, 'oldhead': old['head'], 'restored_control_passed': True}
                      and type(restored['item']) is int, 'Pool656 oldhead restored control missing')
        elif i == 65:
            base = take('item base_screenshots restored')
            b.require(base == {'item': 656, 'base_screenshots': '833d2a153f6fb98ff41c63f0736791f76a1188a8',
                               'restored': True} and type(base['item']) is int,
                      'Pool656 base comparison restoration differs')
        elif i >= 66:
            name, pins = MUTANTS_656[i - 66]
            failure = take('item mutation failed_case')
            b.require(type(failure['item']) is int and failure['item'] == 656
                      and failure['mutation'] == name, 'Pool656 mutation identity differs')
            caught(failure['failed_case'])
            for path, before, mutated in pins:
                trail = take('item mutation file before mutated caught')
                b.require(type(trail['item']) is int and trail['item'] == 656
                          and trail['mutation'] == name and isinstance(trail['file'], str)
                          and Path(trail['file']).is_absolute() and trail['file'].endswith('/' + path)
                          and trail['before'] == before and trail['mutated'] == mutated
                          and trail['caught'] == failure['failed_case'],
                          'Pool656 applied mutation source differs')
            restored = take('item mutation restored_control_passed')
            b.require(restored == {'item': 656, 'mutation': name, 'restored_control_passed': True}
                      and type(restored['item']) is int, 'Pool656 mutant restored control missing')
        records.append(take('name passed engine ms' if webkit else 'name passed started finished'))
    exhausted = object()
    b.require(next(remaining, exhausted) is exhausted, 'Pool656 extra ordered log record')
    return records


def family_results(contents, step, native_step, case_filter, expected, literal_item=None):
    """Interpret only the independently pinned reading/rail reporter families.

    This has no source evaluator. Callers must first verify FAMILIES and the
    shared Pool provenance. Standalone test calls prove parsing, not admission.
    """
    webkit = native_step.startswith('webkit-')
    mode = native_step.replace('webkit-', '')
    engine = 'webkit' if webkit else 'chromium'
    report = b.loads(contents['c1/evidence/native.json'])
    common = 'mode hashes results observations fixtureExitCode fixtureErrors browserClosed '
    b.fields(report, common + ('engine webkitVersion chromeArgumentIgnored qualifications skipped' if webkit else
                              'baseline legacyAdmission finalHealth teardown'))
    b.require(report['mode'] == '--' + mode and report['browserClosed'] is True
              and type(report['fixtureExitCode']) is int and report['fixtureExitCode'] == 0
              and report['fixtureErrors'] == '', 'Pool phase or teardown differs')
    b.require(isinstance(report['hashes'], dict) and bool(report['hashes'])
              and isinstance(report['observations'], list), 'Pool family report schema differs')
    if webkit:
        b.require(report['engine'] == engine and isinstance(report['webkitVersion'], str)
                  and bool(report['webkitVersion']) and isinstance(report['chromeArgumentIgnored'], str)
                  and isinstance(report['qualifications'], list)
                  and all(isinstance(q, str) for q in report['qualifications'])
                  and isinstance(report['skipped'], dict)
                  and all(isinstance(k, str) and isinstance(v, str) and case_filter not in k
                          for k, v in report['skipped'].items()), 'Pool WebKit engine/qualification differs')
    else:
        b.require(report['baseline'] is False and report['legacyAdmission'] is False and report['teardown'] == []
                  and isinstance(report['finalHealth'], dict) and report['finalHealth'].get('fatal') == [],
                  'Pool phase or teardown differs')
    if literal_item:
        wanted_hashes = {p: TRAIN48['sources'][p]
                         for p in SNAPSHOTS_48[native_step]}
        b.require(report['hashes'] == wanted_hashes, 'Pool literal snapshot inputs differ')
    rows = report['results']
    b.require(isinstance(rows, list) and bool(rows), 'Pool missing raw cases')
    b.require(all(isinstance(row, dict) and row.get('passed') is True for row in rows),
              'Pool raw case failed or invalid')
    if literal_item:
        mode_names = [n.replace('colors ', mode + ' ', 1) if literal_item == '656' else n
                      for n in CASES_48[literal_item]]
        b.require([r.get('name') for r in rows] == mode_names, 'Pool literal ordered cases differ')
    keys = []
    for row in rows:
        # A red row (including a caught/unrestored mutant) never becomes green.
        b.require(isinstance(row, dict) and row.get('passed') is True, 'Pool raw case failed or invalid')
        b.fields(row, 'name passed engine ms' if webkit else 'name passed')
        b.require(isinstance(row['name'], str) and (row['name'] == mode + ' ' + case_filter
                  or row['name'].startswith(mode + ' ' + case_filter + ' ')), 'Pool case filter boundary differs')
        if webkit:
            b.require(row['engine'] == engine and type(row['ms']) is int and row['ms'] >= 0,
                      'Pool raw engine or duration differs')
        keys.append(('native-' + native_step, row['name'], None, engine))
    b.require(len(keys) == len(set(keys)), 'duplicate Pool case identity')
    b.require(Counter(keys) == Counter(k for k in expected if k[0] == 'native-' + native_step),
              'Pool own-case obligations differ')
    counts = {'tests': len(rows), 'pass': len(rows), 'fail': 0, 'failed': [], 'browser_closed': True}
    b.require(b.canonical(step['counts']) == b.canonical(counts), 'Pool raw count differs')
    lines = [b.loads(line) for line in contents['c1/native-' + native_step + '.log'].decode().splitlines()]
    if literal_item == '656':
        lines = title_log_records(lines, rows, webkit)
    if webkit:
        b.require(b.canonical(lines) == b.canonical(rows), 'Pool ordered result log differs')
    else:
        b.require(len(lines) == 2 * len(rows), 'Pool ordered start/result log differs')
        for i, row in enumerate(rows):
            start = b.fields(lines[2 * i], 'case started')
            end = b.fields(lines[2 * i + 1], 'name passed started finished')
            b.require(start['case'] == row['name'] and end['name'] == row['name'] and end['passed'] is True
                      and end['started'] == start['started'], 'Pool ordered start/result log differs')
            for value in (start['started'], end['finished']):
                b.require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', value),
                          'Pool case timestamp differs')
                datetime.fromisoformat(value.replace('Z', '+00:00'))
            b.require(end['finished'] >= start['started'], 'Pool case timestamp order differs')
        phases = b.fields(b.loads(contents['c1/evidence/phases.json']),
                          'started cases fixtureReady browserReady reportingStarted reportingEnded')
        clock = [phases[k] for k in ('started', 'fixtureReady', 'browserReady', 'reportingStarted', 'reportingEnded')]
        b.require(all(type(t) is int and t > 0 for t in clock) and clock == sorted(clock)
                  and isinstance(phases['cases'], list) and len(phases['cases']) == len(rows),
                  'Pool incomplete reporting phases')
        previous = phases['browserReady']
        for row, phase in zip(rows, phases['cases']):
            b.fields(phase, 'name started actionStarted actionEnded cleanupEnded')
            times = [phase[k] for k in ('started', 'actionStarted', 'actionEnded', 'cleanupEnded')]
            b.require(phase['name'] == row['name'] and all(type(t) is int and t > 0 for t in times)
                      and times == sorted(times) and previous <= times[0]
                      and times[-1] <= phases['reportingStarted'], 'Pool incomplete case/cleanup phases')
            previous = times[-1]
    return keys


def validate(receipt, git, github, repository, assembly, assembly_tree, expected):
    b.fields(receipt, 'snapshot step report log pool')
    binding = b.fields(b.document(receipt['pool']), 'version run attempt wrapper artifact api record')
    b.require(type(binding['version']) is int and binding['version'] == 1, 'unknown Pool receipt version')
    b.number(binding['run']); b.number(binding['attempt']); b.sha(binding['wrapper'])
    b.fields(binding['artifact'], 'id archive'); b.number(binding['artifact']['id'])
    b.fields(binding['api'], 'run workflow jobs artifact')
    run_id, attempt, wrapper = binding['run'], binding['attempt'], binding['wrapper']
    run = api_fact(binding, 'run', github, repository, 'actions/runs/%d' % run_id)
    b.require(type(run.get('id')) is int and run['id'] == run_id
              and type(run.get('run_attempt')) is int and run['run_attempt'] == attempt
              and run.get('head_sha') == wrapper and run.get('name') == 'Pool'
              and run.get('path') == WORKFLOW and run.get('event') == 'push'
              and run.get('status') == 'completed' and run.get('conclusion') == 'success'
              and run.get('repository', {}).get('full_name') == repository
              and run.get('head_repository', {}).get('full_name') == repository, 'Pool run identity differs')
    b.number(run['workflow_id'])
    workflow = api_fact(binding, 'workflow', github, repository, 'actions/workflows/%d' % run['workflow_id'])
    b.require(workflow.get('id') == run['workflow_id'] and workflow.get('name') == 'Pool'
              and workflow.get('path') == WORKFLOW, 'Pool workflow identity differs')
    jobs = api_fact(binding, 'jobs', github, repository, 'actions/runs/%d/attempts/%d/jobs' % (run_id, attempt))
    b.require(type(jobs.get('total_count')) is int and jobs['total_count'] == 1
              and isinstance(jobs.get('jobs'), list) and len(jobs['jobs']) == 1, 'Pool job inventory differs')
    job = jobs['jobs'][0]; b.number(job['id'])
    b.require(job.get('run_id') == run_id and job.get('run_attempt') == attempt
              and job.get('head_sha') == wrapper and job.get('head_branch') == run['head_branch']
              and job.get('name') == run['head_branch'] and job.get('workflow_name') == 'Pool'
              and job.get('status') == 'completed' and job.get('conclusion') == 'success'
              and job.get('labels') == ['macos-26'], 'Pool job identity differs')
    steps = job.get('steps')
    b.require(isinstance(steps, list) and [s.get('name') for s in steps] == JOB_STEPS
              and all(s.get('status') == 'completed' and s.get('conclusion') == 'success' for s in steps),
              'Pool job steps incomplete')
    meta = api_fact(binding, 'artifact', github, repository, 'actions/artifacts/%d' % binding['artifact']['id'])
    raw_zip = b.artifact(binding['artifact']['archive'])
    b.require(meta.get('id') == binding['artifact']['id'] and meta.get('name') == 'pool'
              and meta.get('expired') is False and meta.get('digest') == 'sha256:' + b.digest(raw_zip)
              and meta.get('workflow_run', {}).get('id') == run_id
              and meta['workflow_run'].get('head_sha') == wrapper
              and meta['workflow_run'].get('head_branch') == run['head_branch']
              and meta['workflow_run'].get('repository_id') == run['repository']['id']
              and meta['workflow_run'].get('head_repository_id') == run['head_repository']['id'],
              'Pool artifact provenance differs')
    b.require(b.parents(git, wrapper) == [assembly], 'Pool wrapper parent differs')
    before, after = b.entries(git, assembly), b.entries(git, wrapper)
    changed = {p for p in set(before) | set(after) if before.get(p) != after.get(p)}
    b.require(changed == {WORKFLOW, SPEC} and WORKFLOW not in before and SPEC not in before
              and all(after[p].startswith('100644 blob ') for p in changed), 'Pool wrapper tree differs')
    initial = source_bytes(git, wrapper, [SPEC])
    spec = b.fields(b.loads(initial[SPEC]), 'step cases label snapshot')
    family = None
    literal_item = None
    if spec['step'] in ('reading', 'webkit-reading', 'rail', 'webkit-rail', 'colors', 'webkit-colors', 'header'):
        tests_tree = b.ask(git, 'rev-parse', '--verify', wrapper + ':tests').strip()
        if tests_tree == TRAIN48['tests_tree']:
            item = '649' if spec['step'] in ('reading', 'webkit-reading') else '656'
            allowed_steps = ('reading', 'webkit-reading') if item == '649' else ('colors', 'webkit-colors', 'header')
            b.require(spec['step'] in allowed_steps, 'Pool literal family step differs')
            family, literal_item = TRAIN48, item
        else:
            b.require(spec['step'] in ('reading', 'webkit-reading', 'rail', 'webkit-rail'),
                      'Pool independently bound tests schema differs')
            item = '717' if spec['step'] in ('reading', 'webkit-reading') else '715'
            profiles = ((FAMILIES[item], ASSEMBLY_717, FINAL_717) if item == '717' else
                        (FAMILIES[item], ASSEMBLY_715, FINAL_715))
            family = next((profile for profile in profiles if profile['tests_tree'] == tests_tree), None)
            b.require(family is not None, 'Pool independently bound tests schema differs')
        if family is TRAIN48 or family is FINAL_715:
            b.require(assembly == family['head'] and assembly_tree == family['tree'],
                      'Pool literal canonical source differs')
        case_filter = 'item ' + item
        authorized = {p: SOURCES[p] for p in (WORKFLOW, 'tools/native.py', 'tools/release_check.py')}
        authorized.update(family['sources'])
        sources = source_bytes(git, wrapper, list(authorized))
    else:
        sources = source_bytes(git, wrapper, list(SOURCES))
        authorized = dict(SOURCES)
        case_filter = 'item 651'
        if b.digest(sources[COMPOSE]) == COMPOSE_652:
            authorized[COMPOSE] = COMPOSE_652
            authorized.update(HELPER_652)
            sources.update(source_bytes(git, wrapper, list(HELPER_652)))
            if all(b.digest(sources[p]) == value for p, value in HELPER_652_CORRECTED.items()):
                authorized.update(HELPER_652_CORRECTED)
            case_filter = 'item 652'
    for path, expected_digest in authorized.items():
        b.require(b.digest(sources[path]) == expected_digest, 'Pool executed source/command differs: ' + path)
    b.require(spec['snapshot'] == assembly and b.tree(git, assembly) == assembly_tree, 'Pool spec snapshot differs')
    b.require(spec['step'] in (('reading', 'webkit-reading', 'rail', 'webkit-rail', 'colors', 'webkit-colors', 'header') if family else ('compose',))
              and isinstance(spec['cases'], list) and len(spec['cases']) == 1 and spec['cases'][0] == case_filter
              and isinstance(spec['label'], str) and re.fullmatch(r'[A-Za-z0-9._-]{1,80}', spec['label']),
              'Pool spec step/filter differs')
    step_name = 'native-' + spec['step']
    log_member = 'c1/' + step_name + '.log'
    members = ('cases.json', 'c1.log', log_member, 'c1/evidence/native.json')
    if family and not spec['step'].startswith('webkit-'):
        members += ('c1/evidence/phases.json',)
    b.require(run['head_branch'] == 'pool/%s-%s' % (spec['label'], assembly[:10]), 'Pool spec branch differs')
    record = b.fields(b.document(binding['record']),
                      'run branch pool_commit snapshot changed pushed_at run_created jobs')
    local_run = b.fields(record['run'], 'conclusion createdAt databaseId headBranch headSha status url workflowName')
    b.require(local_run == {'conclusion': run['conclusion'], 'createdAt': run['created_at'],
                           'databaseId': run_id, 'headBranch': run['head_branch'], 'headSha': wrapper,
                           'status': run['status'], 'url': run['html_url'], 'workflowName': 'Pool'}
              and record['branch'] == run['head_branch'] and record['pool_commit'] == wrapper
              and record['snapshot'] == assembly and record['changed'] == []
              and record['run_created'] == run['created_at']
              and record['jobs'] == [{'name': job['name'], 'started': job['started_at'],
                                      'completed': job['completed_at'], 'conclusion': 'success'}],
              'Pool original record differs')
    pushed = datetime.strptime(record['pushed_at'], '%Y-%m-%dT%H:%M:%S%z')
    b.require(pushed <= datetime.fromisoformat(run['created_at'].replace('Z', '+00:00')),
              'Pool original record time differs')
    snap = b.fields(b.document(receipt['snapshot']),
                    'commit checkout where tree_unchanged snapshot_changes tree_before tree_after')
    b.require(snap['commit'] == assembly and snap['where'] == 'pool' and snap['tree_unchanged'] is True
              and snap['snapshot_changes'] == [] and isinstance(snap['checkout'], str) and Path(snap['checkout']).is_absolute(),
              'Pool snapshot differs or dirty')
    for key in ('tree_before', 'tree_after'):
        b.fields(snap[key], 'head changes')
        b.require(snap[key] == {'head': assembly, 'changes': ''}, 'Pool snapshot differs or dirty')
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as archive:
        names = archive.namelist()
        b.require(len(names) == len(set(names)), 'duplicate Pool archive member')
        for name in names:
            b.safe_path(name)
        b.require(all(n in names for n in members)
                  and not any(re.match(r'c[0-9]+(?:/|\.log$)', n) and not n.startswith(('c1/', 'c1.log')) for n in names),
                  'Pool execution archive inventory differs')
        contents = {name: archive.read(name) for name in members}
    for key, member in [('step', 'c1.log'), ('log', log_member), ('report', 'c1/evidence/native.json')]:
        b.require(b.artifact(receipt[key]) == contents[member], 'Pool raw ' + key + ' differs from archive')
    executions = b.loads(contents['cases.json'])
    b.require(isinstance(executions, list) and len(executions) == 1, 'Pool single execution missing')
    b.fields(executions[0], 'case exit')
    b.require(executions[0]['case'] == case_filter and type(executions[0]['exit']) is int,
              'Pool execution filter/exit differs')
    if family:
        b.report_hashes([b.loads(contents['c1/evidence/native.json'])], git, assembly)
    # Publication can trail the successful upload step by at most two seconds.
    # All identity/source/archive/raw-byte bindings above apply first. These
    # are derived timing facts; never alter the retained API timestamps.
    upload = steps[5]
    try:
        raw_times = [meta['created_at'], upload['started_at'], upload['completed_at']]
        b.require(all(isinstance(value, str) for value in raw_times),
                  'Pool artifact attempt/upload timestamps invalid')
        created, started, finished = [datetime.fromisoformat(value.replace('Z', '+00:00')) for value in raw_times]
        b.require(all(value.utcoffset() is not None for value in (created, started, finished)),
                  'Pool artifact attempt/upload timestamps invalid')
        limit = finished + timedelta(seconds=2)
    except (KeyError, ValueError, TypeError, OverflowError):
        raise b.Refused('base move: Pool artifact attempt/upload timestamps invalid')
    b.require(started <= finished and started <= created <= limit, 'Pool artifact attempt/upload differs')
    publication = {'artifact_created_at': raw_times[0], 'upload_started_at': raw_times[1],
                   'upload_completed_at': raw_times[2], 'max_late_seconds': 2,
                   'not_before': raw_times[1], 'not_after': limit.isoformat(),
                   'seconds_after_upload_completed': (created - finished).total_seconds(),
                   'within_upload': created <= finished}
    b.require(executions[0]['exit'] == 0, 'Pool execution filter/exit differs')
    stdout = contents['c1.log'].decode().splitlines()
    b.require(len(stdout) == 2 and stdout[1] == spec['step'] + ' exit 0 /Users/runner/work/_temp/pool/c1',
              'Pool native command/exit stdout differs')
    step = b.fields(b.loads(stdout[0]), 'name exit passed counts')
    b.require(step['name'] == step_name and type(step['exit']) is int and step['exit'] == 0
              and step['passed'] is True, 'Pool raw step/exit differs')
    if family:
        keys = family_results(contents, step, spec['step'], case_filter, expected, literal_item)
        by_engine = {keys[0][3]: {k[1] for k in keys}}
        schema = 'pool-reading-rail-v1'
        harness = 'tests/webkit_native.mjs' if spec['step'].startswith('webkit-') else 'tests/reader_persistence_native.mjs'
        flags = ['--' + spec['step'].replace('webkit-', '')]
    else:
        keys, by_engine = compose_results(contents, step, case_filter, expected)
        schema, harness, flags = 'pool-compose-prefix-v1', COMPOSE, []
    inputs = {p: b.ask(git, 'rev-parse', '--verify', assembly + ':' + p).strip() for p in authorized if p != WORKFLOW}
    return keys, {'run': run_id, 'attempt': attempt, 'wrapper': wrapper, 'job': job['id'],
                  'artifact': binding['artifact'], 'api': binding['api'], 'record': binding['record'],
                  'originals': {k: receipt[k] for k in ('snapshot', 'step', 'report', 'log', 'pool')},
                  'raw': step,
                  'derived': {'schema': schema, 'publication': publication,
                              'snapshot': {'head': assembly, 'tree': assembly_tree, 'inputs': inputs},
                              'source_sha256': authorized,
                              'command': {'driver': 'tools/native.py', 'step': spec['step'], 'filter': case_filter,
                                          'harness': harness, 'flags': flags,
                                          'dynamic_paths': 'node/chrome/playwright from workflow environment; output RUNNER_TEMP/pool/c1'},
                              **({'schema_binding': {'producer': family['head'], 'tests_tree': family['tests_tree']}} if family else {}),
                              'identity_rule': ('neutral name; engine from exact entrypoint; phase remains null' if family else 'remove exact engine prefix; phase remains null'),
                              'engine_counts': {e: len(by_engine[e]) for e in by_engine}}}


def compose_results(contents, step, case_filter, expected):
    report = b.fields(b.loads(contents['c1/evidence/native.json']),
                      'results browserClosed harnessCompleted plannedPhases completedPhases fixtureExitCode fixtureExitSignal fixtureErrors shortFixture measured shots')
    b.require(ci.compose_completed(report) and report['fixtureErrors'] == '', 'Pool phase or teardown differs')
    short = b.fields(report['shortFixture'], 'exitCode exitSignal errors')
    b.require(type(short['exitCode']) is int and short['exitCode'] == 0 and short['exitSignal'] is None
              and short['errors'] == '', 'Pool short fixture teardown differs')
    b.require(report['measured'] == [] and isinstance(report['shots'], list)
              and all(isinstance(s, str) for s in report['shots']), 'Pool unsupported measurement schema')
    rows = report['results']
    b.require(isinstance(rows, list) and bool(rows), 'Pool missing raw cases')
    for row in rows:
        b.fields(row, 'name passed ms')
        b.require(isinstance(row['name'], str) and bool(row['name']) and row['passed'] is True
                  and type(row['ms']) is int and row['ms'] >= 0, 'Pool raw case failed or invalid')
    counts = {'tests': len(rows), 'pass': len(rows), 'fail': 0, 'failed': [], 'browser_closed': True}
    b.require(b.canonical(step['counts']) == b.canonical(counts), 'Pool raw count differs')
    lines = contents['c1/native-compose.log'].decode().splitlines()
    wanted_lines = []
    mutation_names = ('no-new-tab', 'strip-not-forwarded', 'no-keyboard-open',
                      'first-touch-intercepted-mutant', 'thumbnail-edits-card')
    for row in rows:
        for engine in ('chromium', 'webkit'):
            for mutation in mutation_names:
                if row['name'] == '%s item 651 applied mutant %s and restored source' % (engine, mutation):
                    failure = ('the thumbnail does not edit its card' if mutation == 'thumbnail-edits-card' else
                               'thumbnail opens a new tab: browserContext.waitForEvent: Timeout 5000ms exceeded while waiting for event "page"')
                    wanted_lines.append('CAUGHT item 651 %s %s: %s' % (engine, mutation, failure))
        wanted_lines.append('PASS ' + row['name'])
    b.require(lines == wanted_lines + ['%d passed, 0 failed' % len(rows)],
              'Pool raw PASS lines/count differ')
    # Only now interpret the prefix, established by the exact executed harness
    # check(full = `${engine} ${name}`), ENGINES and completed browser phases.
    keys = []
    for row in rows:
        match = re.fullmatch(r'(chromium|webkit) (\S.*)', row['name'])
        b.require(match is not None, 'Pool unknown engine prefix')
        engine, name = match.groups()
        b.require(any(part in row['name'] for part in case_filter.split('|')), 'Pool case filter differs')
        if case_filter == 'item 652':
            b.require(name == case_filter or name.startswith(case_filter + ' '), 'Pool case filter boundary differs')
        keys.append(('native-compose', name, None, engine))
    b.require(len(keys) == len(set(keys)), 'duplicate Pool case identity')
    by_engine = {e: {k[1] for k in keys if k[3] == e} for e in ('chromium', 'webkit')}
    b.require(bool(by_engine['chromium']) and by_engine['chromium'] == by_engine['webkit'], 'Pool incomplete engine identities')
    selected = [k for k in expected if k[0] == 'native-compose']
    b.require(Counter(keys) == Counter(selected), 'Pool own-case obligations differ')
    return keys, by_engine
