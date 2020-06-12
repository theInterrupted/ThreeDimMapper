//import * as THREE from './three.module.js';
//import { GLTFLoader } from './GLTFLoader.js';

// NOTE
// 1. visibility of objects on the ThreeLayer are reset with the map
//	zoom functionality
// TODO:

const version = 3.10;
d3.select("title").text("Data-Driven 3D Maps " + version);

const poi = [-84.22550713006798,39.9001169544084];//Dayton Intl Airport
//const poi = [-0.4654798239437163,51.47182221826093];//London Heathrow
var symbols = {
	'circle' : {
            'markerType': 'ellipse', //cross,x,triangle,square,diamond,bar,pie,pin,rectangle
            'markerFill': 'rgb(135,196,240)',
            'markerFillOpacity': 1,
            'markerLineColor': '#34495e',
            'markerLineWidth': 3,
            'markerLineOpacity': 1,
            //'markerLineDasharray':[],
            'markerWidth': 10,
            'markerHeight': 10,
            //'markerDx': 0,
            //'markerDy': 0,
            //'markerOpacity' : 1
	}
};
var dtgParse = d3.utcParse("%Y-%m-%d %H:%M:%S");

const margin = ({top: 10, right: 20, bottom: 20, left: 20});
const height = 100;
const width = 500;
const dwidth = width - margin.left - margin.right;
const dheight = height - margin.top - margin.bottom;

const svg = d3.select(".timeline").append("svg")
	//.attr("viewBox", [0, 0, width, height])
	.attr("height", height)
	.attr("width", width);
const datalayer = svg.append("g")
	.attr("id", "datalayer")
	.attr("transform", "translate(" + margin.left + "," + margin.top + ")");

const brush = d3.brushX()
	.extent([[0, 0], [dwidth, dheight]])
    .on("end", brushed);
var brushband = [0,dwidth*.10];
	
datalayer.append("g")
	.attr("id", "data-brush")
    .call(brush);
//    .call(brush.move, [0, 5].map(x));
	
var xscale = d3.scaleUtc().range([0, dwidth]);
var yscale = d3.scaleLinear().range([dheight, 0]);	

var stats, clock, gui, mixer, actions, activeAction, previousAction;
var model, face;
var api = {state: 'Idle' };

var loadedModels = [];
var mtlLoaded = false;
var threeLayer;
var datarefmap = {};

var map = new maptalks.Map('map', {
        center: poi,
        zoom: 18,
		pitch: 60,
        zoomControl: {
          'position'  : 'top-right',
          'slider'    : true,
          'zoomLevel' : true
        },
		scaleControl: {
          'position'  : 'bottom-right',
          'maxWidth': 250,
          'metric': true,
          'imperial': true
        },
        baseLayer: new maptalks.TileLayer('base', {
          urlTemplate: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          subdomains: ['a','b','c','d'],
          attribution: '&copy; <a href="http://osm.org">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/">CARTO</a>'
        })
      });

//THREE.Loader.Handlers.add( /\.dds$/i, new THREE.DDSLoader() );
var modelLib = {
	"truck":{
		obj:'aircraft-tractor-smol-smoothed.obj',
		mtl:'aircraft-tractor-smol-smoothed.mtl'
	},
	"tower":{
		obj:'heathrow atc tower 2.obj',
		mtl:'heathrow atc tower 2.mtl'
	},
	"plane":{
		obj:'dc-10-vs03.obj',
		mtl:'dc-10-vs03.mtl'
	}
};

var layer = new maptalks.VectorLayer('vector').addTo(map);
d3.csv("data/datalog.csv").then(function(data){
	data.forEach(preprocess);
	var timespan = d3.extent(data,d=>d.dtg);
	var msDiff = d3.utcMillisecond.count(timespan[0],timespan[1]) * 0.1;
	timespan = [d3.utcMillisecond.offset(timespan[0],-msDiff),d3.utcMillisecond.offset(timespan[1],msDiff)];

	xscale.domain(timespan);
	yscale.domain(d3.extent(data,d=>d.objectid));
	
	svg.append("g")
		.attr("transform", 'translate(' + margin.left + ',' + (height - margin.bottom) + ')')
		.call(d3.axisBottom(xscale));
	
	datalayer.append("g").selectAll("circle")
		.data(data)
		.enter()
		.append("circle")
			.attr("transform", d=>'translate(' + xscale(d.dtg) + ',' + yscale(d.objectid) + ')')
			.attr("r", 3.5);
	
	data.forEach(function(d){
		datarefmap[d.dataid].feature = new maptalks.Marker(
			[d.lon,d.lat],
			{
			  id: d.dataid,
			  visible : false,
			  cursor : 'pointer',
			  shadowBlur : 0,
			  shadowColor : 'black',
			  draggable : false,
			  dragShadow : false, // display a shadow during dragging
			  drawOnAxis : null,  // force dragging stick on a axis, can be: x, y
			  symbol : symbols.circle
			}
		  );
		  datarefmap[d.dataid].feature.addTo(layer);
	});
	
	createThreeLayer();
});

function createThreeLayer(){
	threeLayer = new maptalks.ThreeLayer('t', {
		forceRenderOnMoving: true,
		forceRenderOnZoom: true
	});
	threeLayer.prepareToDraw = function (gl, scene, camera) {
		var z = threeLayer.distanceToVector3(200, 200).x;
		var v = threeLayer.coordinateToVector3(new maptalks.Coordinate(poi[0], poi[1]),z);

		//var amLight = new THREE.AmbientLight(0xffffff,5);// soft white light
		//amLight.castShadow = false;
		//scene.add(amLight);
		var dirlight = new THREE.DirectionalLight(0xffffff,5);
		dirlight.castShadow = true;
		dirlight.position.set(0,-10,10).normalize(); //(v.x,v.y,v.z);
		scene.add(dirlight);
		camera.add(new THREE.PointLight("#fff", 4));
		
		addGltf();
	};
	
	
	threeLayer.draw = function () {
		if (mtlLoaded) {
			this.renderScene();
		}
	}

	threeLayer.drawOnInteracting = function () {
		if (mtlLoaded) {
			this.renderScene();
		}
	}
	
	threeLayer.addTo(map);
}

function addGltf(){
	clock = new THREE.Clock();
	stats = new Stats();
	map.getContainer().appendChild(stats.dom);
	var loader = new THREE.GLTFLoader();
	
	let dkeys = d3.keys(datarefmap);
	dkeys.forEach(function(key){
		//loadModel(key,threeLayer);
		var d = datarefmap[key];
		var modelObj = modelLib[d.type];
		if (!modelObj || !d.visible) return;
		loader.load('data/bridge-builder-rigged-anim.glb', function( gltf ) {
		//loader.load( 'data/simple_die_2_anim.glb', function ( gltf ) {
			
			model = gltf.scene;
			//model.rotation.x = Math.PI / 2; // maybe not necessary
			//model.scale.set(.01,.01,.01); // for meter-scale
			model.scale.set(.05,.05,.05);
			model.position.copy(threeLayer.coordinateToVector3(new maptalks.Coordinate(d.lon,d.lat)));
			threeLayer.addMesh(model);
			
			createGUI(model, gltf.animations);
			animate();
			

		}, undefined, function ( error ) {

			console.error( error );

		} );
		
	});
}


function createGUI(model, animations){
		var states =['OpenUp','ChompChomp'];
		//var states =['Tipsy','Spin'];
		gui = new dat.GUI();
		
		mixer = new THREE.AnimationMixer(model);
		
		actions = {};
		
		for (var i = 0; i < animations.length; i++){
				var clip = animations[i];
				var action = mixer.clipAction(clip);
				actions[clip.name] = action;
		}
		
		var statesFolder = gui.addFolder('States');
		var clipCtrl = statesFolder.add(api, 'state').options(states);
		clipCtrl.onChange(function() {
			fadeToAction(api.state, 0.5);
		});
		
		statesFolder.open();
		
		activeAction = actions['OpenUp'];
		//activeAction = actions['Tipsy'];
		activeAction.play();
}

function fadeToAction(name,duration){
	previousAction = activeAction;
	activeAction = actions[name];
	if (previousAction !== activeAction){
		previousAction.fadeOut(duration);
	}
	activeAction
		.reset()
		.setEffectiveTimeScale(1)
		.setEffectiveWeight(1)
		.fadeIn(duration)
		.play();
}

function animate(){
	var dt = clock.getDelta();
	if (mixer) mixer.update(dt);
	requestAnimationFrame(animate);
	stats.update();
	if (threeLayer._needsUpdate){
		threeLayer._renderer.clearCanvas();
		threeLayer.renderScene();
	}
}

function resetThreeLayer(){
	map.removeLayer('t');
}

function loadModel(id, threeLayer){
	var d = datarefmap[id];
	var modelObj = modelLib[d.type];
	if (!modelObj || !d.visible) return;
	
	/*
	var geometry = new THREE.BoxGeometry();
	var material = new THREE.MeshBasicMaterial( { color: 0x00ff00 } );
	var cube = new THREE.Mesh( geometry, material );
	
	var model=threeLayer.toModel(cube,{
		coordinate:new maptalks.Coordinate(d.lon,d.lat),
		altitude:0
	});
	d.model = model;
	threeLayer.addMesh( model );
	*/
	
	var loader = new GLTFLoader();

	loader.load( 'data/simple_die.glb', function ( gltf ) {

		scene.add( gltf.scene );
		var model=threeLayer.toModel(gltf.mesh,{
			coordinate:new maptalks.Coordinate(d.lon,d.lat),
			altitude:0
		});
		d.model = model;
		threeLayer.addMesh( model );

	}, undefined, function ( error ) {

		console.error( error );

	} );
	
	
/*
	var mtlLoader = new THREE.MTLLoader();
	//mtlLoader.setPath("");
    mtlLoader.load( 'data/' + modelObj.mtl, function( materials ) {
        materials.preload();
		
		var objLoader = new THREE.OBJLoader();
		objLoader.setMaterials(materials);
		objLoader.load( 'data/' + modelObj.obj, function ( object ) {
			object.traverse( function ( child ) {
				if ( child instanceof THREE.Mesh ) {
				  child.scale.set(.01,.01,.01);
				  child.rotation.set(0, 0, (Math.PI/2)-(d.az * Math.PI / 180));
				}
			});
			
			var model=threeLayer.toModel(object,{
				coordinate:new maptalks.Coordinate(d.lon,d.lat),
				altitude:0
			});
			d.model = model;

			threeLayer.addMesh(model);
			
			//model.hide();
			//tooltip test
			//model.setToolTip('obj model', {
			//		showTimeout: 0,
			//		eventsPropagation: true,
			//		dx: 10
			//});

			model.on('mouseover mouseout',function(e){
			   //var scale=1;
			   //if(e.type==='mouseover'){
				// scale=1.5;
			   //}
			   //this.getObject3d().scale.set(1,1,scale);
			});
			
			threeLayer.renderScene();
			//datalayer.select("#data-brush")
			//	.call(brush.move, brushband);
		});
	});*/
}
 
function brushed(){
	const selection = d3.event.selection;
	if (selection === null){
	} else {
		brushband = selection;
		refresh();
		
		//const [x0,x1] = selection.map(xscale.invert);
		//filterDataByTime(selection.map(xscale.invert));
		//threeLayer.redraw();
	}
}

function refresh(){
	console.log("Refresh");
	filterDataByTime(brushband.map(xscale.invert));
	resetThreeLayer();
	createThreeLayer();
}

function filterDataByTime(timeband = brushband.map(xscale.invert)){
	let [start,end] = timeband;
	let dkeys = d3.keys(datarefmap);
	dkeys.forEach(function(key){
		let v = datarefmap[key].dtg>=start && datarefmap[key].dtg<=end;
		datarefmap[key].visible = v;
		if (v){
			if (datarefmap[key].model) datarefmap[key].model.show();
			if (datarefmap[key].feature) datarefmap[key].feature.show();
		} else {
			if (datarefmap[key].model) datarefmap[key].model.hide();
			if (datarefmap[key].feature) datarefmap[key].feature.hide();
		}
	});
}

function preprocess(d){
	d.dtg = dtgParse(d.dtg);
	d.objectid = +d.objectid;
	datarefmap[d.dataid] = {visible:false,dtg: d.dtg,type:d.type,lon:d.lon,lat:d.lat,az:d.az};
}
