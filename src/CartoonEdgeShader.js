import * as THREE from 'three';

const vertexShader = /* glsl */`
  uniform float thickness;

  void main() {
    vec3 expanded = position + normalize(normal) * thickness;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(expanded, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3 color;

  void main() {
    gl_FragColor = vec4(color, 1.0);
  }
`;

export class CartoonOutline {
  constructor(target, options = {}) {
    this.options = {
      thickness: 0.01,
      color: 0x000000,
      renderOrder: 95,
      ...options,
    };
    this.outlineMeshes = [];
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        thickness: { value: this.options.thickness },
        color: { value: new THREE.Color(this.options.color) },
      },
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: false,
    });
    this.build(target);
  }

  build(target) {
    target.traverse((child) => {
      if (!child.isMesh || !child.geometry || child.userData?.isSelectionOutline) return;

      const outline = new THREE.Mesh(child.geometry, this.material);
      outline.name = `${child.name || 'mesh'}_outline`;
      outline.renderOrder = this.options.renderOrder;
      outline.frustumCulled = false;
      outline.userData.isSelectionOutline = true;
      child.add(outline);
      this.outlineMeshes.push(outline);
    });
  }

  setVisible(visible) {
    this.outlineMeshes.forEach((mesh) => {
      mesh.visible = visible;
    });
  }

  setThickness(value) {
    this.material.uniforms.thickness.value = value;
  }

  setColor(color) {
    this.material.uniforms.color.value.set(color);
  }

  dispose() {
    this.outlineMeshes.forEach((mesh) => {
      mesh.parent?.remove(mesh);
    });
    this.material.dispose();
    this.outlineMeshes = [];
  }
}
